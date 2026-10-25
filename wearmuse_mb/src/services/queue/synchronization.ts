import { AppState } from 'react-native';
import * as Network from 'expo-network';

import { API_BASE_URL, configurationError } from '../../config/env';
import { ApiClient } from '../api/client';
import { GarmentsApi } from '../api/garments';
import { repository } from '../storage/database';
import { cacheRemoteAsset, removeGarmentFiles } from '../storage/files';
import { prepareUploadImage } from '../storage/uploadImage';
import { UploadQueue } from './uploadQueue';
import { ProcessingPoller } from './processingPoller';
import { SyncEngine } from './syncEngine';

let current: { stop: () => void; wake: () => void; users: number } | null = null;

/** Start only after SQLite initialization. JS work pauses in background and resumes on foreground. */
export function startSynchronization(): () => void {
  if (configurationError || !API_BASE_URL) return () => {};
  if (!current) {
    const api = new GarmentsApi(new ApiClient(API_BASE_URL), prepareUploadImage);
    const locks = new Set<string>();
    const dependencies = { repository, api, locks };
    const engine = new SyncEngine(new UploadQueue(dependencies), new ProcessingPoller({
      ...dependencies, cacheRemoteAsset, removeGarmentFiles,
    }));
    let disposed = false;
    let initialized = false;
    let networkRevision = 0;
    let foreground = AppState.currentState === 'active';
    const applyForeground = () => engine.setForeground(initialized && foreground);
    const refreshNetwork = async () => {
      const revision = ++networkRevision;
      try {
        const state = await Network.getNetworkStateAsync();
        if (!disposed && revision === networkRevision) engine.setConnected(state.isConnected === true);
      } catch { if (!disposed && revision === networkRevision) engine.setConnected(false); }
    };
    const appSubscription = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      applyForeground();
      if (foreground) void refreshNetwork();
    });
    const networkSubscription = Network.addNetworkStateListener((state) => {
      networkRevision++;
      // The AI server can be reachable over local Wi-Fi without public Internet access.
      engine.setConnected(state.isConnected === true);
    });
    const unsubscribe = repository.subscribe((id) => {
      engine.wake();
      if (id) void repository.get(id).then((row) => { if (!row) engine.cancel(id); }).catch(() => {});
    });
    let preparing = false;
    const prepare = async () => {
      if (disposed || initialized || preparing) return;
      preparing = true;
      try {
        await repository.recoverInterrupted();
        if (disposed) return;
        initialized = true;
        applyForeground();
        void refreshNetwork();
      } catch {
        // A temporary SQLite failure can be retried while originals remain safely on disk.
      } finally { preparing = false; }
    };
    void prepare();
    // Native events normally suffice; this also recovers from a failed initial network query.
    const connectivityTimer = setInterval(() => {
      if (foreground) { void prepare(); void refreshNetwork(); }
    }, 15_000);
    current = {
      users: 0,
      wake: () => engine.wake(),
      stop: () => {
        disposed = true;
        appSubscription.remove(); networkSubscription.remove(); unsubscribe();
        clearInterval(connectivityTimer);
        engine.stop();
      },
    };
  }
  const owner = current;
  owner.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owner.users--;
    if (owner.users === 0) { owner.stop(); if (current === owner) current = null; }
  };
}

export async function retryGarment(localId: string): Promise<void> {
  const garment = await repository.get(localId);
  if (!garment) return;
  if (garment.remoteId && garment.status === 'ready') {
    // A missing/failed local preview needs another download, not another GPU inference.
    await repository.update(localId, {
      cutoutLocalUri: null, thumbnailLocalUri: null, retryRequested: false,
      pollAttempts: 0, nextPollAt: 0, lastError: null,
    });
    current?.wake();
    return;
  }
  await repository.update(localId, {
    status: garment.remoteId ? garment.status : 'upload_queued',
    retryRequested: !!garment.remoteId,
    uploadAttempts: 0,
    pollAttempts: 0,
    nextAttemptAt: 0,
    nextPollAt: 0,
    lastError: null,
  });
  current?.wake();
}
