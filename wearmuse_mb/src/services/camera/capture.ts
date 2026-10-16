import { initializeWardrobe } from '../../features/wardrobe/store';
import type { Garment } from '../../types/garment';
import { repository } from '../storage/database';
import { persistOriginal, removeGarmentFiles } from '../storage/files';

let captureSequence = 0;
function createLocalId() {
  return `local_${Date.now().toString(36)}_${captureSequence++}_${Math.random().toString(36).slice(2, 13)}`;
}

/** Dependency injection keeps the copy-before-commit boundary testable without a camera or native runtime. */
export function createPhotoSaver(dependencies: {
  initialize: () => Promise<void>;
  persist: typeof persistOriginal;
  insert: (garment: Garment) => Promise<void>;
  cleanup: (id: string) => Promise<void>;
  createId?: () => string;
}) {
  return async (uri: string, mimeType?: string, fileName?: string): Promise<Garment> => {
    await dependencies.initialize();
    const localId = (dependencies.createId ?? createLocalId)();
    let committed = false;
    try {
      const saved = await dependencies.persist(localId, uri, mimeType, fileName);
      const timestamp = new Date().toISOString();
      const garment: Garment = {
        localId, remoteId: null,
        originalLocalUri: saved.uri, cutoutLocalUri: null, thumbnailLocalUri: null,
        originalRemoteUrl: null, cutoutRemoteUrl: null, thumbnailRemoteUrl: null,
        mimeType: saved.mimeType, fileName: saved.fileName,
        // This single INSERT also persists the pending upload job.
        status: 'upload_queued', uploadAttempts: 0, nextAttemptAt: 0,
        pollAttempts: 0, nextPollAt: 0, retryRequested: false,
        lastError: null, createdAt: timestamp, updatedAt: timestamp,
      };
      await dependencies.insert(garment);
      committed = true;
      return garment;
    } catch (error) {
      if (!committed) {
        try { await dependencies.cleanup(localId); } catch { /* Startup orphan cleanup retries this safely. */ }
      }
      throw error;
    }
  };
}

export const savePhoto = createPhotoSaver({
  initialize: initializeWardrobe,
  persist: persistOriginal,
  insert: (garment) => repository.insert(garment),
  cleanup: removeGarmentFiles,
});
