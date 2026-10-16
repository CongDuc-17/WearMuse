import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';

import type { Garment } from '../../types/garment';

const folderName = 'wearmuse-garments-v1';
const safeId = /^[A-Za-z0-9_-]{1,100}$/;
const deletedIds = new Set<string>();
let assetSequence = 0;

/** React Native's AbortSignal polyfill has `aborted`, but not `throwIfAborted`. */
function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error && signal.reason.name === 'AbortError') throw signal.reason;
  const error = new Error('Đã tạm dừng đồng bộ.');
  error.name = 'AbortError';
  throw error;
}

function root(): Directory {
  return new Directory(Paths.document, folderName);
}

function garmentDirectory(localId: string): Directory {
  if (!safeId.test(localId)) throw new Error('Mã món đồ không hợp lệ.');
  const parent = root();
  const directory = new Directory(parent, localId);
  // Never delete a path derived from an original image URI or a server response.
  if (directory.uri.replace(/\/$/, '') !== `${parent.uri.replace(/\/$/, '')}/${localId}`) {
    throw new Error('Đường dẫn lưu ảnh không hợp lệ.');
  }
  return directory;
}

function ensureDirectory(localId: string): Directory {
  if (deletedIds.has(localId)) throw new Error('Món đồ đã được xóa.');
  const directory = garmentDirectory(localId);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** Access for derived assets shares the same validated directory and deletion tombstone. */
export function getGarmentStorageDirectory(localId: string): Directory {
  return ensureDirectory(localId);
}

export function assertGarmentFilesActive(localId: string, signal?: AbortSignal): void {
  throwIfAborted(signal);
  garmentDirectory(localId);
  if (deletedIds.has(localId)) {
    const error = new Error('Món đồ đã được xóa.');
    error.name = 'AbortError';
    throw error;
  }
}

function removeIfPresent(file: File) {
  if (file.exists) file.delete();
}

function imageMetadata(uri: string, mimeType?: string, fileName?: string) {
  const byExtension: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', gif: 'image/gif',
  };
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/gif': 'gif',
  };
  const extension = (fileName ?? uri).split('?')[0].match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  const resolvedMime = mimeType?.toLowerCase() === 'image/jpg'
    ? 'image/jpeg'
    : mimeType?.toLowerCase() ?? byExtension[extension ?? ''] ?? 'image/jpeg';
  if (!byMime[resolvedMime]) throw new Error('Định dạng ảnh chưa được hỗ trợ. Hãy chọn một ảnh khác.');
  const resolvedName = `original.${byMime[resolvedMime]}`;
  return { mimeType: resolvedMime, fileName: resolvedName };
}

/** Resolves only after the native asynchronous copy has completed in Documents. */
export async function persistOriginal(
  localId: string,
  uri: string,
  mimeType?: string,
  fileName?: string,
): Promise<{ uri: string; mimeType: string; fileName: string }> {
  if (!/^(file|content):\/\//i.test(uri)) throw new Error('Không thể đọc ảnh trên thiết bị.');
  const metadata = imageMetadata(uri, mimeType, fileName);
  const directory = ensureDirectory(localId);
  const partial = new File(directory, `pending-${metadata.fileName}`);
  const destination = new File(directory, metadata.fileName);
  try {
    await new File(uri).copy(partial);
    if (!partial.exists || partial.size <= 0) throw new Error('Ảnh chưa được lưu đầy đủ.');
    if (deletedIds.has(localId)) throw new Error('Món đồ đã được xóa.');
    await partial.move(destination);
    if (!destination.exists || destination.size <= 0) throw new Error('Không thể lưu ảnh trên thiết bị.');
    return { uri: destination.uri, ...metadata };
  } catch (error) {
    removeIfPresent(partial);
    removeIfPresent(destination);
    throw error;
  }
}

export async function cacheRemoteAsset(
  localId: string,
  url: string,
  kind: 'cutout' | 'thumbnail',
  signal?: AbortSignal,
): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Địa chỉ ảnh xử lý không hợp lệ.');
  throwIfAborted(signal);
  const directory = ensureDirectory(localId);
  // New names also avoid stale decoded image caches after a processing retry.
  const suffix = `${Date.now()}-${assetSequence++}.${kind === 'cutout' ? 'png' : 'webp'}`;
  const partial = new File(directory, `pending-${kind}-${suffix}`);
  const destination = new File(directory, `${kind}-${suffix}`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; abort(); }, 45_000);
  try {
    const task = File.createDownloadTask(url, partial, {
      signal: controller.signal,
      sessionType: 'foreground',
    });
    const downloaded = await task.downloadAsync();
    if (!downloaded || !partial.exists || partial.size <= 0) throw new Error('Ảnh xử lý chưa tải xong.');
    throwIfAborted(controller.signal);
    // Native asynchronous decoding rejects HTML/error bodies and corrupt images.
    const decoded = await Image.loadAsync(partial.uri, { maxWidth: 1024, maxHeight: 1024 });
    try {
      if (decoded.width <= 0 || decoded.height <= 0) throw new Error('Ảnh xử lý không hợp lệ.');
    } finally {
      decoded.release();
    }
    throwIfAborted(controller.signal);
    if (deletedIds.has(localId)) throw new Error('Món đồ đã được xóa.');
    await partial.move(destination);
    if (deletedIds.has(localId)) throw new Error('Món đồ đã được xóa.');
    return destination.uri;
  } catch (error) {
    removeIfPresent(partial);
    removeIfPresent(destination);
    // A timeout needs persisted backoff; the poller treats caller AbortError as a lifecycle pause.
    if (timedOut && !signal?.aborted) throw new Error('Tải ảnh xử lý quá lâu. Ứng dụng sẽ thử lại.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function removeGarmentFiles(localId: string): Promise<void> {
  const directory = garmentDirectory(localId);
  deletedIds.add(localId);
  if (directory.exists) directory.delete();
}

/** iOS may relocate the app container during an update; persist identity, then rebase only our own paths. */
export async function reconcileGarmentFiles(garment: Garment): Promise<Partial<Garment>> {
  const directory = garmentDirectory(garment.localId);
  const marker = `/${folderName}/${garment.localId}/`;
  const patch: Partial<Garment> = {};
  const resolve = (uri: string, pattern: RegExp): File | null => {
    const markerIndex = uri.lastIndexOf(marker);
    if (markerIndex < 0) return null;
    const filename = uri.slice(markerIndex + marker.length);
    if (!pattern.test(filename)) return null;
    return new File(directory, filename);
  };
  const original = resolve(garment.originalLocalUri, /^original\.(jpg|png|webp|heic|heif|avif|gif)$/);
  if (original?.exists && original.size > 0) {
    if (original.uri !== garment.originalLocalUri) patch.originalLocalUri = original.uri;
  } else if (!garment.remoteId) {
    // Keep the metadata and identify the failure; never silently delete a captured garment.
    patch.status = 'failed';
    patch.lastError = 'Không tìm thấy ảnh gốc trên thiết bị. Hãy chụp lại món đồ này.';
  }
  for (const [key, pattern] of [
    ['cutoutLocalUri', /^cutout-[0-9]+-[0-9]+\.png$/],
    ['thumbnailLocalUri', /^thumbnail-[0-9]+-[0-9]+\.webp$/],
  ] as const) {
    const stored = garment[key];
    if (!stored) continue;
    const file = resolve(stored, pattern);
    if (file?.exists && file.size > 0) {
      if (file.uri !== stored) patch[key] = file.uri;
    } else {
      patch[key] = null;
      if (key === 'cutoutLocalUri' && garment.status === 'ready') {
        patch.nextPollAt = 0;
        patch.pollAttempts = 0;
      }
    }
  }
  return patch;
}

/** Run before capture/sync starts: collect files left by a crash between copy and INSERT/delete. */
export async function cleanupOrphanedGarmentFiles(garments: readonly Garment[]): Promise<void> {
  const directory = root();
  if (!directory.exists) return;
  const knownIds = new Set(garments.map((garment) => garment.localId));
  for (const entry of directory.list()) {
    if (entry instanceof Directory && safeId.test(entry.name) && !knownIds.has(entry.name)) {
      await removeGarmentFiles(entry.name);
    }
  }
}
