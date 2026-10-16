import { Platform } from 'react-native';

export const colors = {
  background: '#F8F6F1',
  surface: '#EFEBE3',
  paper: '#FFFEFB',
  ink: '#262722',
  muted: '#6D6D64',
  line: '#DFDCD3',
  accent: '#586249',
  accentLight: '#E6EBDD',
  warning: '#85582C',
  warningLight: '#F4E8D9',
  danger: '#984C44',
  white: '#FFFFFF',
  camera: '#151612',
} as const;

export const fonts = {
  editorial: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' }),
} as const;

export const layout = { gutter: 24, gap: 12, maxWidth: 680 } as const;
