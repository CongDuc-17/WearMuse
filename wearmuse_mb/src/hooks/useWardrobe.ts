import { useEffect, useSyncExternalStore } from 'react';

import { initializeWardrobe, reloadWardrobe, wardrobeStore } from '../features/wardrobe/store';

export { initializeWardrobe } from '../features/wardrobe/store';

export function useWardrobe() {
  const state = useSyncExternalStore(wardrobeStore.subscribe, wardrobeStore.getSnapshot, wardrobeStore.getSnapshot);
  useEffect(() => { void initializeWardrobe().catch(() => undefined); }, []);
  return { ...state, reload: reloadWardrobe };
}
