import { Button as HeroButton, Spinner, useThemeColor } from 'heroui-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';

type Props = {
  title: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

/** Keep action/loading semantics while using HeroUI's built-in appearance. */
export function Button({ title, onPress, icon, variant = 'primary', disabled, loading, style, accessibilityHint }: Props) {
  const [primary, secondary, danger] = useThemeColor(['accent-foreground', 'default-foreground', 'danger-soft-foreground']);
  const foreground = variant === 'primary' ? primary : variant === 'danger' ? danger : secondary;
  return (
    <HeroButton variant={variant === 'danger' ? 'danger-soft' : variant} size="lg"
      accessibilityLabel={title} accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      isDisabled={Boolean(disabled || loading)} onPress={onPress}
      className="h-auto min-h-12" style={style}>
      {loading ? <Spinner size="sm" color={foreground} /> : icon ? <Icon name={icon} size={20} color={foreground} /> : null}
      <HeroButton.Label className="shrink text-center">{title}</HeroButton.Label>
    </HeroButton>
  );
}

export function IconButton({ name, label, onPress, disabled = false, size = 'lg' }: {
  name: IconName; label: string; onPress: () => void; disabled?: boolean; size?: 'md' | 'lg';
}) {
  const foreground = useThemeColor('foreground');
  return (
    <HeroButton isIconOnly size={size} variant="secondary" accessibilityLabel={label} isDisabled={disabled} onPress={onPress}>
      <Icon name={name} color={foreground} />
    </HeroButton>
  );
}
