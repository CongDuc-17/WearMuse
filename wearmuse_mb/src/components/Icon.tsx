import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { colors } from '@/constants/tokens';

export type IconName = ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 22, color = colors.ink }: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} accessible={false} />;
}
