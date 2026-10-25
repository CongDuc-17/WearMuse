import '../../global.css';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { HeroUINativeProvider, useThemeColor, type HeroUINativeConfig } from 'heroui-native';
import { useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useUniwind } from 'uniwind';

import { RuntimeProvider } from '@/features/runtime/RuntimeProvider';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export default function RootLayout() {
  const reducedMotion = useReducedMotion();
  const backgroundColor = useThemeColor('background');
  const { theme } = useUniwind();
  const uiConfig = useMemo<HeroUINativeConfig>(() => ({
    animation: reducedMotion ? 'disable-all' : undefined,
    devInfo: { stylingPrinciples: false },
  }), [reducedMotion]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <HeroUINativeProvider config={uiConfig}>
          <ThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
            <RuntimeProvider>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false, animation: reducedMotion ? 'none' : 'default', contentStyle: { backgroundColor } }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: reducedMotion ? 'none' : 'slide_from_bottom' }} />
                <Stack.Screen name="garment/[id]" />
              </Stack>
            </RuntimeProvider>
          </ThemeProvider>
        </HeroUINativeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
