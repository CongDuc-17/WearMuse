import { Chip, useThemeColor } from 'heroui-native';
import type { GarmentStatus } from '@/types/garment';
import { Icon } from './Icon';

export const statusLabels: Record<GarmentStatus, string> = {
  local_saved: 'Đã lưu ảnh', upload_queued: 'Chờ tải lên', uploading: 'Đang tải ảnh',
  queued: 'Chờ tách nền', processing: 'Đang tách nền', ready: 'Đã tách nền',
  needs_review: 'Cần thử lại', failed: 'Chưa xử lý được',
};

export function ProcessingIndicator({ status, compact = false }: { status: GarmentStatus; compact?: boolean }) {
  const warning = status === 'failed' || status === 'needs_review';
  const ready = status === 'ready';
  const [muted, success, attention] = useThemeColor(['accent-soft-foreground', 'success-soft-foreground', 'warning-soft-foreground']);
  return (
    <Chip size={compact ? 'sm' : 'md'} variant="soft" color={warning ? 'warning' : ready ? 'success' : 'accent'}
      className="h-auto max-w-full self-start" accessibilityLabel={statusLabels[status]}>
      <Icon name={warning ? 'alert-circle' : ready ? 'check-circle' : 'clock'} size={14} color={warning ? attention : ready ? success : muted} />
      <Chip.Label className="shrink">{statusLabels[status]}</Chip.Label>
    </Chip>
  );
}
