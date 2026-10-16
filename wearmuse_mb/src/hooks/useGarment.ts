import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { initializeWardrobe, wardrobeStore } from '../features/wardrobe/store';
import type { Garment } from '../types/garment';

export function useGarment(id: string): Garment | null {
  const subscribe = useCallback((listener: () => void) => wardrobeStore.subscribeGarment(id, listener), [id]);
  const getSnapshot = useCallback(() => wardrobeStore.getGarment(id), [id]);
  useEffect(() => { void initializeWardrobe().catch(() => undefined); }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
