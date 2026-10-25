import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFloatingNavLayout } from '@/components/navigation/layout';

export function useFloatingNavLayout() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return getFloatingNavLayout({ width, insets });
}
