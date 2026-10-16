import { ApiError, isAbortError } from '../api/client';
import { diagnosticError, logDiagnostic } from '../diagnostics/logger';
import { ActiveJobs, backoffMs, describeFailure, POLL_INTERVAL_MS, remotePatch, type SyncDependencies } from './contracts';

export interface PollerDependencies extends SyncDependencies {
  cacheRemoteAsset(localId: string, url: string, kind: 'cutout' | 'thumbnail', signal?: AbortSignal): Promise<string>;
  removeGarmentFiles(localId: string): Promise<void>;
}

/** A single global pass; per-item locks also exclude upload/retry operations. */
export class ProcessingPoller {
  private running = false;
  private readonly now: () => number;
  private readonly jobs: ActiveJobs;

  constructor(private readonly dependencies: PollerDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.jobs = new ActiveJobs(dependencies.locks ?? new Set());
  }
  cancel(id: string) { this.jobs.cancel(id); }
  cancelAll() { this.jobs.cancelAll(); }

  async tick(signal?: AbortSignal): Promise<void> {
    if (this.running || signal?.aborted) return;
    this.running = true;
    try {
      const candidates = await this.dependencies.repository.getPollCandidates(this.now());
      for (const candidate of candidates) {
        if (signal?.aborted) break;
        if (this.jobs.has(candidate.localId)) continue;
        const garment = await this.dependencies.repository.get(candidate.localId);
        if (!garment?.remoteId || garment.retryRequested || this.jobs.has(candidate.localId)) continue;
        const job = this.jobs.begin(garment.localId, signal);
        try {
          const item = await this.dependencies.api.get(garment.remoteId, job.signal);
          if (job.signal.aborted || (await this.dependencies.repository.get(garment.localId))?.retryRequested) continue;
          const patch = remotePatch(item, this.dependencies.api, this.now());
          if (!(await this.dependencies.repository.update(garment.localId, patch))) continue;
          if (item.status !== 'ready') continue;
          if (!patch.cutoutRemoteUrl) throw new ApiError('AI đã xử lý nhưng ảnh xem trước chưa sẵn sàng.', 'protocol', true);

          // cacheRemoteAsset verifies the complete, decodable image before returning.
          const cutout = garment.cutoutLocalUri ?? await this.dependencies.cacheRemoteAsset(
            garment.localId, patch.cutoutRemoteUrl, 'cutout', job.signal,
          );
          if (job.signal.aborted) continue;
          const latest = await this.dependencies.repository.get(garment.localId);
          if (!latest || latest.retryRequested) continue;
          if (!(await this.dependencies.repository.update(garment.localId, {
            cutoutLocalUri: cutout, pollAttempts: 0, nextPollAt: 0, lastError: null,
          }))) continue;

          if (patch.thumbnailRemoteUrl && !latest.thumbnailLocalUri) {
            try {
              const thumbnail = await this.dependencies.cacheRemoteAsset(
                garment.localId, patch.thumbnailRemoteUrl, 'thumbnail', job.signal,
              );
              if (!job.signal.aborted && !(await this.dependencies.repository.get(garment.localId))?.retryRequested) {
                await this.dependencies.repository.update(garment.localId, { thumbnailLocalUri: thumbnail });
              }
            } catch {
              // Older backend items may have no thumbnail. The verified PNG is sufficient.
            }
          }
        } catch (error) {
          if (job.signal.aborted || isAbortError(error)) continue;
          logDiagnostic('poll_error', { localId: garment.localId, ...diagnosticError(error) });
          const failure = describeFailure(error);
          const attempts = garment.pollAttempts + 1;
          await this.dependencies.repository.update(garment.localId, {
            ...(failure.retryable ? {} : { status: 'failed' as const }),
            pollAttempts: attempts, lastError: failure.message,
            nextPollAt: this.now() + Math.max(POLL_INTERVAL_MS, backoffMs(attempts)),
          });
        } finally {
          job.end();
          // Deletion can race a completed download. Do not recreate orphan image folders.
          if (!(await this.dependencies.repository.get(garment.localId))) {
            await this.dependencies.removeGarmentFiles(garment.localId);
          }
        }
      }
    } finally { this.running = false; }
  }
}
