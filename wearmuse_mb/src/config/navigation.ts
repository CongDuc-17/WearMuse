import type { Href } from 'expo-router';
import type { IconName } from '@/components/Icon';

type NavigationEntry = {
  id: string;
  label: string;
  icon: IconName;
  route: Href;
};

export type NavigationItem = NavigationEntry & (
  | { type: 'tab'; screen: string }
  | { type: 'action' }
);

// A tab also needs a matching screen file in src/app/(tabs).
export const navigationItems: readonly NavigationItem[] = [
  { id: 'home', label: 'Tủ đồ', icon: 'grid', route: '/', type: 'tab', screen: 'index' },
  { id: 'camera', label: 'Chụp ảnh', icon: 'camera', route: '/scan', type: 'action' },
  { id: 'profile', label: 'Cá nhân', icon: 'user', route: '/profile', type: 'tab', screen: 'profile' },
];

function normalizePath(path: string): string {
  return path.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
}

export function getActiveNavigationId(
  pathname: string,
  items: readonly NavigationItem[] = navigationItems,
): string | null {
  const currentPath = normalizePath(pathname);
  let match: { id: string; length: number } | null = null;

  for (const item of items) {
    if (item.type !== 'tab') continue;
    const route = normalizePath(typeof item.route === 'string' ? item.route : item.route.pathname);
    const matches = currentPath === route || (route !== '/' && currentPath.startsWith(`${route}/`));
    if (matches && (!match || route.length > match.length)) match = { id: item.id, length: route.length };
  }

  return match?.id ?? null;
}
