import type { Garment } from '../../types/garment';
import type { GarmentApi, RemoteGarment } from '../api/garments';
import { ApiError, linkedController } from '../api/client';

export interface SyncRepository {
  get(localId: string): Promise<Garment | null>;
  update(localId: string, patch: Partial<Garment>): Promise<boolean>;
  getUploadCandidates(now: number): Promise<Garment[]>;
  getPollCandidates(now: number): Promise<Garment[]>;
}

export interface SyncDependencies {
  repository: SyncRepository;
  api: GarmentApi;
  now?: () => number;
  locks?: Set<string>;
}

export const MAX_UPLOAD_ATTEMPTS = 5;
export const POLL_INTERVAL_MS = 2_500;

export function backoffMs(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, Math.min(attempts - 1, 10)));
}

export function describeFailure(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof ApiError) return { message: error.message, retryable: error.retryable };
  return { message: 'Không thể đồng bộ lúc này. Ảnh vẫn được lưu trên thiết bị.', retryable: true };
}

export function remotePatch(item: RemoteGarment, api: GarmentApi, now: number): Partial<Garment> {
  return {
    remoteId: item.id,
    status: item.status,
    originalRemoteUrl: item.original_url ? api.resolveUrl(item.original_url) : null,
    cutoutRemoteUrl: item.cutout_url ? api.resolveUrl(item.cutout_url) : null,
    thumbnailRemoteUrl: item.thumbnail_url ? api.resolveUrl(item.thumbnail_url) : null,
    lastError: item.status === 'failed' ? 'AI chưa xử lý được ảnh. Bạn có thể thử lại.'
      : item.status === 'needs_review' ? 'Ảnh cần được kiểm tra. Hãy thử lại hoặc chụp ảnh rõ hơn.' : null,
    pollAttempts: 0,
    nextPollAt: item.status === 'ready' ? now : now + POLL_INTERVAL_MS,
  };
}

/** Shared locks prevent a retry and a status/download request for the same item overlapping. */
export class ActiveJobs {
  private controllers = new Map<string, AbortController>();
  constructor(private readonly locks: Set<string>) {}
  has(id: string) { return this.locks.has(id); }
  begin(id: string, signal?: AbortSignal) {
    const link = linkedController(signal);
    this.locks.add(id);
    this.controllers.set(id, link.controller);
    return {
      signal: link.controller.signal,
      end: () => { link.dispose(); this.controllers.delete(id); this.locks.delete(id); },
    };
  }
  cancel(id: string) { this.controllers.get(id)?.abort(); }
  cancelAll() { for (const controller of this.controllers.values()) controller.abort(); }
}
