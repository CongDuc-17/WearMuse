import { File } from 'expo-file-system';

import type { Garment } from '../../types/garment';
import { abortError, ApiClient, ApiError } from './client';
import { diagnosticError, logDiagnostic } from '../diagnostics/logger';

export type RemoteStatus = 'queued' | 'processing' | 'ready' | 'needs_review' | 'failed';

/** Additional response fields are preserved for future clothing metadata. */
export interface RemoteGarment {
  [key: string]: unknown;
  id: string;
  status: RemoteStatus;
  original_url: string | null;
  cutout_url: string | null;
  thumbnail_url: string | null;
  error: string | null;
}

export function parseRemoteGarment(value: unknown): RemoteGarment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  const item = value as Record<string, unknown>;
  const status = item.status === 'error' ? 'failed' : item.status;
  if (typeof item.id !== 'string' || !item.id.trim()
    || typeof status !== 'string' || !['queued', 'processing', 'ready', 'needs_review', 'failed'].includes(status)) {
    throw invalidResponse();
  }
  const nullableString = (key: string): string | null => {
    const field = item[key];
    if (field == null || field === '') return null;
    if (typeof field !== 'string') throw invalidResponse();
    return field;
  };
  return {
    ...item, id: item.id, status: status as RemoteStatus,
    original_url: nullableString('original_url'),
    cutout_url: nullableString('cutout_url'),
    thumbnail_url: nullableString('thumbnail_url'),
    error: nullableString('error'),
  };
}

function invalidResponse() {
  return new ApiError('Phản hồi món đồ từ máy chủ không hợp lệ.', 'protocol', true);
}

export interface GarmentApi {
  upload(garment: Garment, signal?: AbortSignal): Promise<RemoteGarment>;
  get(remoteId: string, signal?: AbortSignal): Promise<RemoteGarment>;
  retry(remoteId: string, signal?: AbortSignal): Promise<RemoteGarment>;
  resolveUrl(path: string): string;
}

export class GarmentsApi implements GarmentApi {
  constructor(
    private readonly client: ApiClient,
    private readonly prepareUpload: (garment: Garment, signal?: AbortSignal) => Promise<Garment> = async (garment) => garment,
  ) {}
  resolveUrl(path: string) { return this.client.resolveUrl(path); }

  async upload(garment: Garment, signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
    let phase = 'preparing_image';
    logDiagnostic(phase, { localId: garment.localId });
    try {
      const prepared = await this.prepareUpload(garment, signal);
      if (signal?.aborted) throw abortError();
      phase = 'building_form';
      logDiagnostic('image_prepared', { localId: garment.localId, mimeType: prepared.mimeType });
      const form = new FormData();
      // SDK 57's Expo fetch reads File.bytes(); legacy { uri, name, type } parts are unsupported.
      // The normalized upload.jpg supplies its native filename and image/jpeg MIME type.
      form.append('file', new File(prepared.originalLocalUri));
      phase = 'upload_request';
      return parseRemoteGarment(await this.client.request('/v1/items', { method: 'POST', body: form }, signal, {
        localId: garment.localId, operation: 'upload',
      }));
    } catch (error) {
      if (phase === 'building_form' && !signal?.aborted && !(error instanceof ApiError)) {
        error = new ApiError('Ứng dụng chưa thể tạo dữ liệu gửi ảnh. Hãy tải lại ứng dụng rồi thử lại.', 'multipart', false, null, error);
      }
      logDiagnostic(signal?.aborted ? 'upload_cancelled' : 'upload_error', {
        localId: garment.localId, phase, ...diagnosticError(error),
      });
      throw error;
    }
  }

  async get(remoteId: string, signal?: AbortSignal) {
    const item = parseRemoteGarment(await this.client.request(`/v1/items/${encodeURIComponent(remoteId)}`, {}, signal, { operation: 'poll' }));
    return this.verifyId(item, remoteId);
  }

  async retry(remoteId: string, signal?: AbortSignal) {
    const item = parseRemoteGarment(await this.client.request(`/v1/items/${encodeURIComponent(remoteId)}/retry`, { method: 'POST' }, signal, { operation: 'retry' }));
    return this.verifyId(item, remoteId);
  }

  private verifyId(item: RemoteGarment, expectedId: string) {
    if (item.id !== expectedId) throw invalidResponse();
    return item;
  }
}

