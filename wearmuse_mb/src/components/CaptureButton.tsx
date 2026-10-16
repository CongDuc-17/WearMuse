import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/constants/tokens';

export function CaptureButton({ onPress, disabled, busy }: { onPress: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? 'Đang lưu ảnh' : 'Chụp món đồ'}
      accessibilityHint="Ảnh được lưu tự động, sau đó bạn có thể chụp tiếp"
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.ring, disabled && styles.disabled, pressed && styles.pressed]}>
      <View style={styles.shutter}>{busy && <ActivityIndicator color={colors.ink} />}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: { width: 86, height: 86, borderRadius: 43, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center', padding: 5 },
  shutter: { flex: 1, alignSelf: 'stretch', borderRadius: 40, backgroundColor: colors.white, justifyContent: 'center', alignItems: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
});
