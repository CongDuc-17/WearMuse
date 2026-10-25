import { useSyncExternalStore } from 'react';
import { wardrobeStore } from '@/features/wardrobe/store';
import { useWardrobe } from './useWardrobe';

/** Stable collection snapshot updates on item status changes as well as additions. */
export function useWardrobeCollection() {
  const state = useWardrobe();
  const garments = useSyncExternalStore(wardrobeStore.subscribeCollection, wardrobeStore.getCollection, wardrobeStore.getCollection);
  return { ...state, garments };
}
