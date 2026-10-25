import Feather from '@expo/vector-icons/Feather';
import { useThemeColor } from 'heroui-native';
import type { ComponentProps } from 'react';

export type IconName = ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const foreground = useThemeColor('foreground');
  return <Feather name={name} size={size} color={color ?? foreground} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden />;
}
