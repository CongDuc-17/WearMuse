import { useFocusEffect, usePathname, useRouter } from 'expo-router';
import { Tabs, useThemeColor } from 'heroui-native';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { getActiveNavigationId, navigationItems, type NavigationItem } from '@/config/navigation';
import { useFloatingNavLayout } from '@/hooks/useFloatingNavLayout';
import { useKeyboardVisible } from '@/hooks/useKeyboardVisible';

type Props = {
  items?: readonly NavigationItem[];
  onTabPress?: (item: NavigationItem) => boolean;
  onTabLongPress?: (item: NavigationItem) => void;
};

function NavigationTrigger({ item, selected, onLongPress }: {
  item: NavigationItem; selected: boolean;
  onLongPress?: (item: NavigationItem) => void;
}) {
  const foreground = useThemeColor(selected ? 'segment-foreground' : 'muted');
  return (
    <Tabs.Trigger value={item.id} className="min-h-12 min-w-12 flex-1"
      testID={`floating-nav-${item.id}`}
      role={item.type === 'tab' ? 'tab' : 'button'}
      accessibilityRole={item.type === 'tab' ? 'tab' : 'button'} accessibilityLabel={item.label}
      accessibilityHint={item.type === 'action' ? 'Mở camera để chụp và lưu món đồ' : `Chuyển đến ${item.label}`}
      accessibilityState={item.type === 'tab' ? { selected } : {}}
      aria-selected={item.type === 'tab' ? selected : undefined}
      onLongPress={item.type === 'tab' && onLongPress ? () => onLongPress(item) : undefined}>
      <Icon name={item.icon} size={24} color={foreground} />
    </Tabs.Trigger>
  );
}

export function FloatingBottomNav({ items = navigationItems, onTabPress, onTabLongPress }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const metrics = useFloatingNavLayout();
  const keyboardVisible = useKeyboardVisible();
  const actionInFlight = useRef(false);
  const activeId = getActiveNavigationId(pathname, items);

  useEffect(() => { actionInFlight.current = false; }, [pathname]);
  useFocusEffect(useCallback(() => {
    actionInFlight.current = false;
    return () => { actionInFlight.current = false; };
  }, []));

  const navigate = useCallback((value: string) => {
    const item = items.find((entry) => entry.id === value);
    if (!item) return;
    if (item.type === 'action') {
      // Lock synchronously: a second tap may arrive before the modal changes focus.
      if (actionInFlight.current) return;
      actionInFlight.current = true;
      try { router.push(item.route); }
      catch (error) { actionInFlight.current = false; throw error; }
      return;
    }
    if (onTabPress?.(item) === false || item.id === activeId) return;
    router.navigate(item.route);
  }, [activeId, items, onTabPress, router]);

  const hiddenRoute = pathname === '/scan' || pathname.startsWith('/scan/') || pathname === '/garment' || pathname.startsWith('/garment/');
  if (keyboardVisible || hiddenRoute || items.length === 0) return null;

  return (
    <View pointerEvents="box-none" className="bg-background" style={[styles.backdrop, { height: metrics.contentInset }]}>
      <View testID="floating-nav-anchor" pointerEvents="box-none" style={[styles.anchor, { bottom: metrics.bottomOffset, left: metrics.horizontalInset, right: metrics.horizontalInset }]}>
        <Tabs value={activeId ?? ''} onValueChange={navigate} className="w-full" style={{ maxWidth: metrics.maxWidth }}>
          <Tabs.List className="w-full" accessibilityLabel="Điều hướng chính">
            <Tabs.Indicator />
            {items.map((item) => <NavigationTrigger key={item.id} item={item} selected={item.type === 'tab' && item.id === activeId} onLongPress={onTabLongPress} />)}
          </Tabs.List>
        </Tabs>
      </View>
    </View>
  );
}
export default FloatingBottomNav;

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  anchor: { position: 'absolute', alignItems: 'center' },
});
