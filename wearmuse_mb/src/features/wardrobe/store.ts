import { repository } from '../../services/storage/database';
import { cleanupOrphanedGarmentFiles, reconcileGarmentFiles } from '../../services/storage/files';
import type { Garment } from '../../types/garment';

type Listener = () => void;
interface WardrobeSnapshot {
  ids: readonly string[];
  loading: boolean;
  error: string | null;
}

const garments = new Map<string, Garment>();
const itemListeners = new Map<string, Set<Listener>>();
const listListeners = new Set<Listener>();
let snapshot: WardrobeSnapshot = { ids: [], loading: true, error: null };
let initialization: Promise<void> | null = null;
let refreshes: Promise<void> = Promise.resolve();
let subscribed = false;

function publishSnapshot(next: WardrobeSnapshot) {
  if (next.ids === snapshot.ids && next.loading === snapshot.loading && next.error === snapshot.error) return;
  snapshot = next;
  listListeners.forEach((listener) => listener());
}

function publishItem(id: string, garment: Garment | null) {
  const previous = garments.get(id);
  if (JSON.stringify(previous ?? null) === JSON.stringify(garment)) return;
  if (garment) garments.set(id, garment); else garments.delete(id);
  itemListeners.get(id)?.forEach((listener) => listener());
}

function updateIds() {
  const ids = [...garments.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.localId.localeCompare(a.localId))
    .map((garment) => garment.localId);
  if (ids.length === snapshot.ids.length && ids.every((id, index) => id === snapshot.ids[index])) return;
  publishSnapshot({ ...snapshot, ids });
}

async function refreshAll() {
  const records = await repository.list();
  const ids = new Set(records.map((record) => record.localId));
  for (const id of garments.keys()) if (!ids.has(id)) publishItem(id, null);
  for (const record of records) publishItem(record.localId, record);
  updateIds();
}

function queueRefresh(id: string | null) {
  refreshes = refreshes.then(async () => {
    if (id === null) await refreshAll();
    else {
      publishItem(id, await repository.get(id));
      updateIds();
    }
    if (snapshot.error) publishSnapshot({ ...snapshot, error: null });
  }).catch(() => {
    publishSnapshot({ ...snapshot, error: 'Không thể cập nhật tủ đồ. Hãy thử tải lại.' });
  });
}

export function initializeWardrobe(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    publishSnapshot({ ...snapshot, loading: true, error: null });
    await repository.initialize();
    await repository.recoverInterrupted();
    const records = await repository.list();
    for (const record of records) {
      const patch = await reconcileGarmentFiles(record);
      if (Object.keys(patch).length) await repository.update(record.localId, patch);
    }
    // Cleanup only after the database has opened successfully; never infer an empty closet on failure.
    try { await cleanupOrphanedGarmentFiles(records); } catch (error) { console.warn('Wardrobe cleanup deferred', error); }
    if (!subscribed) {
      repository.subscribe(queueRefresh);
      subscribed = true;
    }
    await refreshAll();
    publishSnapshot({ ...snapshot, loading: false, error: null });
  })().catch((error: unknown) => {
    initialization = null;
    publishSnapshot({ ...snapshot, loading: false, error: 'Không thể mở tủ đồ trên thiết bị. Hãy thử lại.' });
    throw error;
  });
  return initialization;
}

export async function reloadWardrobe(): Promise<void> {
  await initializeWardrobe();
  queueRefresh(null);
  await refreshes;
  if (!snapshot.error) publishSnapshot({ ...snapshot, loading: false, error: null });
}

export const wardrobeStore = {
  getSnapshot: () => snapshot,
  getGarment: (id: string) => garments.get(id) ?? null,
  subscribe(listener: Listener) {
    listListeners.add(listener);
    return () => { listListeners.delete(listener); };
  },
  subscribeGarment(id: string, listener: Listener) {
    let listeners = itemListeners.get(id);
    if (!listeners) { listeners = new Set(); itemListeners.set(id, listeners); }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) itemListeners.delete(id);
    };
  },
};
