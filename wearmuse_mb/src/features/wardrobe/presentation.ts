import type { Garment } from '@/types/garment';

export type WardrobeFilter = 'all' | 'ready' | 'processing' | 'attention';
export const wardrobeFilters: { id: WardrobeFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'ready', label: 'Đã tách nền' },
  { id: 'processing', label: 'Đang xử lý' },
  { id: 'attention', label: 'Cần thử lại' },
];

export function garmentGroup(garment: Garment): Exclude<WardrobeFilter, 'all'> {
  if (garment.status === 'failed' || garment.status === 'needs_review') return 'attention';
  if (garment.status === 'ready' && garment.cutoutLocalUri) return 'ready';
  return 'processing';
}

export function summarizeWardrobe(garments: readonly Garment[]) {
  return garments.reduce((counts, garment) => {
    counts.all += 1;
    counts[garmentGroup(garment)] += 1;
    return counts;
  }, { all: 0, ready: 0, processing: 0, attention: 0 });
}

export function filterWardrobe(garments: readonly Garment[], filter: WardrobeFilter) {
  return filter === 'all' ? garments : garments.filter((garment) => garmentGroup(garment) === filter);
}
