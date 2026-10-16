import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/constants/tokens';
import { Icon, type IconName } from './Icon';

type Props = {
  title: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'danger' | 'light';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({ title, onPress, icon, variant = 'primary', disabled, loading, style, accessibilityHint }: Props) {
  const foreground = variant === 'primary' ? colors.white : variant === 'danger' ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles[variant], pressed && styles.pressed, (disabled || loading) && styles.disabled, style]}>
      {loading ? <ActivityIndicator color={foreground} size="small" /> : icon ? <Icon name={icon} size={20} color={foreground} /> : null}
      <Text style={[styles.label, { color: foreground }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ name, label, onPress, light = false, disabled = false }: {
  name: IconName;
  label: string;
  onPress: () => void;
  light?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, light && styles.lightIcon, pressed && styles.pressed, disabled && styles.disabled]}>
      <Icon name={name} color={light ? colors.white : colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 56, borderRadius: 18, paddingHorizontal: 24, paddingVertical: 15, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.ink },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#DFC7C1' },
  light: { backgroundColor: colors.white },
  label: { fontSize: 15, fontWeight: '600', letterSpacing: 0.2, flexShrink: 1, textAlign: 'center' },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  lightIcon: { backgroundColor: '#FFFFFF18', borderColor: '#FFFFFF25' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
