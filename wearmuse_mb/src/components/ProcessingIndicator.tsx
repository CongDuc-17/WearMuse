import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/tokens';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { GarmentStatus } from '@/types/garment';
import { Icon } from './Icon';

export const statusLabels: Record<GarmentStatus, string> = {
  local_saved: 'Đã lưu ảnh',
  upload_queued: 'Chờ tải lên',
  uploading: 'Đang tải ảnh',
  queued: 'Chờ tách nền',
  processing: 'Đang tách nền',
  ready: 'Đã tách nền',
  needs_review: 'Cần thử lại',
  failed: 'Chưa xử lý được',
};

export function ProcessingIndicator({ status, compact = false }: { status: GarmentStatus; compact?: boolean }) {
  const reducedMotion = useReducedMotion();
  const warning = status === 'failed' || status === 'needs_review';
  const ready = status === 'ready';
  return (
    <View style={[styles.badge, warning && styles.warning, compact && styles.compact]}>
      {warning ? <Icon name="alert-circle" size={13} color={colors.warning} />
        : ready ? <Icon name="check" size={13} color={colors.accent} />
          : reducedMotion ? <View style={styles.dot} /> : <ActivityIndicator size={12} color={colors.accent} />}
      <Text style={[styles.text, warning && styles.warningText]}>{statusLabels[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, backgroundColor: colors.accentLight, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  compact: { backgroundColor: '#FFFEFBEF', paddingHorizontal: 8, paddingVertical: 6 },
  warning: { backgroundColor: colors.warningLight },
  text: { fontSize: 11, lineHeight: 15, fontWeight: '600', color: colors.accent, flexShrink: 1 },
  warningText: { color: colors.warning },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent },
});
