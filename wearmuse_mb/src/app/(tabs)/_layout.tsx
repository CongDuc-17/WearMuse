import { Tabs } from 'expo-router';
import { FloatingBottomNav } from '@/components/navigation/FloatingBottomNav';
import { navigationItems } from '@/config/navigation';
import { useThemeColor } from 'heroui-native';
import { useFloatingNavLayout } from '@/hooks/useFloatingNavLayout';

export default function TabLayout() {
  const backgroundColor = useThemeColor('background');
  const { contentInset } = useFloatingNavLayout();

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor, paddingBottom: contentInset },
      }}
      tabBar={({ state, emitter }) => (
        <FloatingBottomNav
          onTabPress={(item) => {
            if (item.type !== 'tab') return true;
            const route = state.routes.find((candidate) => candidate.name === item.screen);
            if (!route) return false;
            return !emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true }).defaultPrevented;
          }}
          onTabLongPress={(item) => {
            if (item.type !== 'tab') return;
            const route = state.routes.find((candidate) => candidate.name === item.screen);
            if (route) emitter.emit({ type: 'tabLongPress', target: route.key });
          }}
        />
      )}
    >
      {navigationItems.filter((item) => item.type === 'tab').map((item) => (
        <Tabs.Screen key={item.id} name={item.screen} options={{ title: item.label }} />
      ))}
    </Tabs>
  );
}
