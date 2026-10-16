import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RuntimeProvider } from '@/features/runtime/RuntimeProvider';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export default function RootLayout() {
  const reducedMotion = useReducedMotion();
  return (
    <SafeAreaProvider>
      <RuntimeProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, animation: reducedMotion ? 'none' : 'default', contentStyle: { backgroundColor: '#F8F5F0' } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: reducedMotion ? 'none' : 'slide_from_bottom' }} />
          <Stack.Screen name="garment/[id]" />
        </Stack>
      </RuntimeProvider>
    </SafeAreaProvider>
  );
}
