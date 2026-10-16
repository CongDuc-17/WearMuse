import type { Garment } from '../../types/garment';
import { abortError, ApiError, isAbortError } from '../api/client';
import { diagnosticError, logDiagnostic } from '../diagnostics/logger';
import { ActiveJobs, describeFailure, backoffMs, MAX_UPLOAD_ATTEMPTS, remotePatch, type SyncDependencies } from './contracts';

/** One queue instance uploads one file at a time. Every retry decision is persisted. */
export class UploadQueue {
  private running = false;
  private readonly jobs: ActiveJobs;
  private readonly now: () => number;

  constructor(private readonly dependencies: SyncDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.jobs = new ActiveJobs(dependencies.locks ?? new Set());
  }

  cancel(id: string) { this.jobs.cancel(id); }
  cancelAll() { this.jobs.cancelAll(); }

  async drain(signal?: AbortSignal): Promise<void> {
    if (this.running || signal?.aborted) return;
    this.running = true;
    try {
      while (!signal?.aborted) {
        const candidates = await this.dependencies.repository.getUploadCandidates(this.now());
        const candidate = candidates.find((row) => !this.jobs.has(row.localId));
        if (!candidate) break;
        const garment = await this.dependencies.repository.get(candidate.localId);
        if (this.jobs.has(candidate.localId)) break;
        if (!garment || (garment.remoteId && !garment.retryRequested)) continue;
        if (garment.uploadAttempts >= MAX_UPLOAD_ATTEMPTS) {
          await this.dependencies.repository.update(garment.localId, {
            status: 'failed', retryRequested: false,
            lastError: 'Đã thử đồng bộ nhiều lần. Ảnh vẫn được lưu; bạn có thể thử lại.',
          });
          continue;
        }
        await this.process(garment, signal);
      }
    } finally { this.running = false; }
  }

  private async process(garment: Garment, signal?: AbortSignal) {
    const { repository, api } = this.dependencies;
    const job = this.jobs.begin(garment.localId, signal);
    const attempt = garment.uploadAttempts + 1;
    try {
      if (job.signal.aborted) return;
      const exists = await repository.update(garment.localId, {
        uploadAttempts: attempt,
        ...(garment.remoteId ? {} : { status: 'uploading' as const }),
        lastError: null,
      });
      if (!exists) return;
      if (job.signal.aborted) throw abortError();
      logDiagnostic('queue_attempt', { localId: garment.localId, attempt, operation: garment.remoteId ? 'retry' : 'upload' });
      let item;
      if (garment.remoteId) {
        try { item = await api.retry(garment.remoteId, job.signal); }
        catch (error) {
          // FastAPI returns 409 when a previous retry already queued the item.
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          item = await api.get(garment.remoteId, job.signal);
        }
      } else {
        item = await api.upload(garment, job.signal);
      }
      // Persist a received server ID even if the app has just entered the background.
      // A lost POST response cannot be recovered without backend idempotency support.
      if (!(await repository.update(garment.localId, { remoteId: item.id }))) return;
      await repository.update(garment.localId, {
        ...remotePatch(item, api, this.now()), retryRequested: false, nextAttemptAt: 0,
        ...(garment.remoteId ? { cutoutLocalUri: null, thumbnailLocalUri: null } : {}),
      });
      logDiagnostic('upload_accepted', { localId: garment.localId, remoteStatus: item.status });
    } catch (error) {
      logDiagnostic(job.signal.aborted ? 'queue_cancelled' : 'queue_error', {
        localId: garment.localId, attempt, ...diagnosticError(error),
      });
      const latest = await repository.get(garment.localId);
      if (job.signal.aborted || isAbortError(error)) {
        if (!garment.remoteId && latest?.remoteId) {
          await repository.update(garment.localId, {
            status: 'queued', retryRequested: false, nextPollAt: 0,
          });
          return;
        }
        await repository.update(garment.localId, {
          uploadAttempts: garment.uploadAttempts,
          ...(garment.remoteId ? {} : { status: 'upload_queued' as const }),
          nextAttemptAt: 0,
        });
        return;
      }
      const failure = describeFailure(error);
      // Once the ID was persisted, recover by GET even if a later metadata write failed.
      // Never turn an accepted remote item back into a new multipart upload.
      if (!garment.remoteId && latest?.remoteId) {
        await repository.update(garment.localId, {
          status: failure.retryable ? 'queued' : 'failed', retryRequested: false,
          lastError: failure.message, nextPollAt: this.now() + backoffMs(attempt),
        });
        return;
      }
      const retry = failure.retryable && attempt < MAX_UPLOAD_ATTEMPTS;
      logDiagnostic(retry ? 'retry_scheduled' : 'upload_failed', {
        localId: garment.localId, attempt, retryable: failure.retryable,
      });
      await repository.update(garment.localId, {
        status: retry ? (garment.remoteId ? garment.status : 'upload_queued') : 'failed',
        retryRequested: retry && !!garment.remoteId,
        lastError: failure.message,
        nextAttemptAt: retry ? this.now() + backoffMs(attempt) : 0,
      });
    } finally { job.end(); }
  }
}
