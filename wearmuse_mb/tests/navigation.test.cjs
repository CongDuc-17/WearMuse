const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadTs } = require('./helpers/load-ts.cjs');
const { loadTsx } = require('./helpers/load-tsx.cjs');

const appRoot = path.resolve(__dirname, '../src/app');

function flattenStyle(styles) {
  if (!Array.isArray(styles)) return styles || {};
  return Object.assign({}, ...styles.map(flattenStyle));
}

/** React renders the actual component; only native primitives and device preferences are replaced. */
function navigationHarness(options = {}) {
  const environment = {
    width: 320, bottom: 0, left: 0, right: 0, pathname: '/', keyboardVisible: false,
    reducedMotion: true, fontScale: 1, ...options,
  };
  const presses = [];
  const views = [];
  const routes = [];
  const animations = [];
  const refs = [];
  let refCursor = 0;
  let effects = [];
  let focusCallback;
  const config = loadTs('src/config/navigation.ts');
  const layout = loadTs('src/components/navigation/layout.ts');
  class AnimatedValue {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation(callback) { callback?.(this.value); }
    interpolate(configuration) { return { value: this.value, configuration }; }
  }
  function nativeView(props) {
    views.push(props);
    return React.createElement('div', { 'data-testid': props.testID }, props.children);
  }
  const animated = {
    Value: AnimatedValue,
    View: nativeView,
    spring(value, configuration) {
      const record = { kind: 'spring', ...configuration };
      animations.push(record);
      return { start(callback) { value.setValue(configuration.toValue); callback?.({ finished: true }); }, stop() {} };
    },
    timing(value, configuration) {
      const record = { kind: 'timing', ...configuration };
      animations.push(record);
      return { start(callback) { value.setValue(configuration.toValue); callback?.({ finished: true }); }, stop() {} };
    },
    parallel(group) { return { start() { group.forEach((animation) => animation.start()); }, stop() { group.forEach((animation) => animation.stop()); } }; },
  };
  const native = {
    Animated: animated,
    Pressable(props) {
      presses.push({ ...props, style: flattenStyle(typeof props.style === 'function' ? props.style({ pressed: false }) : props.style) });
      return React.createElement('button', {
        'data-testid': props.testID, 'aria-label': props.accessibilityLabel,
        'aria-selected': props.accessibilityState?.selected,
        role: props.accessibilityRole,
      }, props.children);
    },
    View: nativeView,
    Text(props) { return React.createElement('span', null, props.children); },
    StyleSheet: { create: (styles) => styles, flatten: flattenStyle, absoluteFillObject: {} },
    useWindowDimensions: () => ({ width: environment.width, height: 700, scale: 1, fontScale: environment.fontScale }),
    Platform: { OS: 'ios', select: (values) => values.ios ?? values.default },
  };
  const safeArea = { useSafeAreaInsets: () => ({ top: 0, bottom: environment.bottom, left: environment.left, right: environment.right }) };
  const layoutHook = loadTs('src/hooks/useFloatingNavLayout.ts', {
    'react-native': native, 'react-native-safe-area-context': safeArea,
    '@/components/navigation/layout': layout, '../components/navigation/layout': layout,
    '@/config/navigation': config, '../config/navigation': config,
  });
  const tabs = loadTsx('node_modules/heroui-native/src/primitives/tabs/tabs.tsx', {
    'react-native': native, '../slot': {},
  });
  const heroTabs = Object.assign(tabs.Root, {
    List: tabs.List, Trigger: tabs.Trigger, Indicator: tabs.Indicator,
  });
  const component = loadTsx('src/components/navigation/FloatingBottomNav.tsx', {
    'heroui-native': { Tabs: heroTabs, useThemeColor: () => 'currentColor' },
    react: {
      ...React,
      useCallback: (callback) => callback,
      useMemo: (factory) => factory(),
      useRef(initial) { const index = refCursor++; return refs[index] ??= { current: initial }; },
      useEffect(callback) { effects.push(callback); },
    },
    'react-native': native,
    'react-native-safe-area-context': safeArea,
    'expo-router': {
      usePathname: () => environment.pathname,
      useRouter: () => ({ push: (href) => routes.push({ method: 'push', href }), navigate: (href) => routes.push({ method: 'navigate', href }) }),
      useFocusEffect: (callback) => { focusCallback = callback; },
    },
    '@/components/Icon': { Icon: ({ name }) => React.createElement('i', { 'data-icon': name }) },
    '@/hooks/useReducedMotion': { useReducedMotion: () => environment.reducedMotion },
    '@/hooks/useKeyboardVisible': { useKeyboardVisible: () => environment.keyboardVisible },
    '@/hooks/useFloatingNavLayout': layoutHook,
    '@/config/navigation': config,
  });
  return {
    config, layout, environment, presses, views, routes, animations,
    render(items, props = {}) {
      presses.length = 0; views.length = 0; refCursor = 0; effects = [];
      const html = renderToStaticMarkup(React.createElement(component.FloatingBottomNav, { ...(items ? { items } : {}), ...props }));
      const callbacks = effects; effects = [];
      callbacks.forEach((callback) => callback());
      return html;
    },
    focus() { focusCallback?.(); },
  };
}

function routeFiles(directory = appRoot, segments = []) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = entry.name;
    if (entry.isDirectory()) return routeFiles(path.join(directory, name), [...segments, name]);
    if (!/\.(tsx|ts)$/.test(name) || name.startsWith('_')) return [];
    const visible = [...segments, name.replace(/\.(tsx|ts)$/, '')]
      .filter((segment) => !/^\(.+\)$/.test(segment));
    if (visible.at(-1) === 'index') visible.pop();
    return [`/${visible.join('/')}`];
  });
}

test('production navigation configuration uses unique IDs and existing Router screens', () => {
  const { navigationItems, getActiveNavigationId } = loadTs('src/config/navigation.ts');
  const routes = new Set(routeFiles());
  assert.equal(new Set(navigationItems.map((item) => item.id)).size, navigationItems.length);
  assert.equal(navigationItems.length, 3);
  for (const item of navigationItems) {
    assert.ok(item.label.trim());
    const route = typeof item.route === 'string' ? item.route : item.route.pathname;
    assert.ok(routes.has(route), `${item.id} must point to an actual route file: ${route}`);
    if (item.type === 'tab') {
      assert.ok(fs.existsSync(path.join(appRoot, '(tabs)', `${item.screen}.tsx`)), `${item.id} needs a real tab screen`);
      assert.equal(getActiveNavigationId(route), item.id);
    } else {
      assert.equal(getActiveNavigationId(route), null, 'camera remains an action rather than a selected tab');
    }
  }
});

test('active route matching handles nested paths, parameters and segment boundaries without selecting camera', () => {
  const { navigationItems, getActiveNavigationId } = loadTs('src/config/navigation.ts');
  assert.equal(getActiveNavigationId('/'), 'home');
  assert.equal(getActiveNavigationId('/profile/?source=closet#settings'), 'profile');
  assert.equal(getActiveNavigationId('/profile/preferences'), 'profile');
  assert.equal(getActiveNavigationId('/profiles'), null);
  assert.equal(getActiveNavigationId('/scan'), null);
  assert.equal(getActiveNavigationId('/garment/local-123'), null);
  const nested = { ...navigationItems.find((item) => item.id === 'profile'), id: 'preferences', route: { pathname: '/profile/preferences' } };
  assert.equal(getActiveNavigationId('/profile/preferences/privacy', [...navigationItems, nested]), 'preferences', 'most specific matching tab wins');
});

for (const itemCount of [3, 4, 5]) {
  for (const bottom of [0, 34]) {
    test(`${itemCount} items fit a 320px phone with bottom safe area ${bottom} and equal >=48px touch slots`, () => {
      const { getFloatingNavLayout } = loadTs('src/components/navigation/layout.ts');
      const metrics = getFloatingNavLayout({ width: 320, itemCount, insets: { left: 0, right: 0, bottom } });
      const barWidth = Math.min(320 - 2 * metrics.horizontalInset, metrics.maxWidth);
      const availableSlotsWidth = barWidth - 2 * metrics.barPadding - 4 * (itemCount - 1);
      const equalSlotWidth = availableSlotsWidth / itemCount;
      assert.ok(equalSlotWidth >= 48, `${itemCount} controls must retain comfortable touch width, got ${equalSlotWidth}`);
      assert.ok(metrics.barHeight - metrics.barPadding * 2 >= 48);
      assert.ok(metrics.bottomOffset >= bottom + 12, 'floating bar clears the system gesture area');
      assert.ok(metrics.contentInset >= metrics.bottomOffset + metrics.barHeight + 12, 'scroll content can clear the whole floating bar');
      assert.ok(Math.abs(equalSlotWidth * itemCount - availableSlotsWidth) < 0.001);
      assert.equal(metrics.barHeight, 54, 'icon-only tabs stay compact');
    });
  }
}

test('landscape safe areas, tablets and larger text retain clearance and cap the bar width', () => {
  const { getFloatingNavLayout } = loadTs('src/components/navigation/layout.ts');
  const base = getFloatingNavLayout({ width: 844, itemCount: 5, insets: { left: 47, right: 21, bottom: 21 } });
  const accessible = getFloatingNavLayout({ width: 844, fontScale: 1.6, itemCount: 5, insets: { left: 47, right: 21, bottom: 21 } });
  assert.ok(base.horizontalInset > 47);
  assert.ok(base.maxWidth <= 560);
  assert.equal(accessible.barHeight, base.barHeight, 'there are no visible labels to scale');
  assert.equal(accessible.contentInset, base.contentInset);
});

function itemFixtures(config, count) {
  const profile = config.navigationItems.find((item) => item.id === 'profile');
  const items = [...config.navigationItems];
  while (items.length < count) items.push({ ...profile, id: `fixture-${items.length + 1}`, label: `Mục ${items.length + 1}` });
  return items;
}

for (const count of [3, 4, 5]) {
  for (const bottom of [0, 34]) {
  test(`icon-only HeroUI tabs expose ${count} named controls with safe area ${bottom}`, () => {
    const app = navigationHarness({ bottom });
    const fixtures = itemFixtures(app.config, count);
    const html = app.render(fixtures);
    assert.equal(app.presses.length, count);
    assert.deepEqual(app.presses.map((press) => press.testID), fixtures.map((item) => `floating-nav-${item.id}`));
    for (const press of app.presses) {
      assert.match(press.className, /min-h-12/);
      assert.match(press.className, /min-w-12/);
      assert.match(press.className, /flex-1/);
      assert.ok(press.accessibilityLabel?.trim());
    }
    assert.equal(app.presses.filter((press) => press.accessibilityState?.selected).length, 1);
    const anchor = flattenStyle(app.views.find((view) => view.testID === 'floating-nav-anchor').style);
    assert.ok(anchor.bottom >= bottom + 12);
    assert.ok(!/<span>/.test(html), 'labels remain accessible names instead of visible text');
    assert.equal(app.presses.find((press) => press.testID === 'floating-nav-camera').role, 'button');
    assert.match(html, /aria-selected="true"/);
  });
  }
}

test('camera pushes scan once until focus returns; active tabs do not navigate again', () => {
  const app = navigationHarness();
  app.render();
  const press = (id) => app.presses.find((entry) => entry.testID === `floating-nav-${id}`).onPress();
  press('home');
  assert.equal(app.routes.length, 0);
  press('profile');
  assert.deepEqual(app.routes, [{ method: 'navigate', href: '/profile' }]);
  press('camera'); press('camera');
  assert.deepEqual(app.routes.slice(1), [{ method: 'push', href: '/scan' }]);
  app.focus();
  press('camera');
  assert.deepEqual(app.routes.slice(1), [{ method: 'push', href: '/scan' }, { method: 'push', href: '/scan' }]);
  assert.notEqual(app.presses.find((entry) => entry.testID === 'floating-nav-camera').accessibilityState?.selected, true);
});

test('the selected tab follows the actual pathname and the bar is hidden while the keyboard is visible', () => {
  const app = navigationHarness({ pathname: '/profile' });
  app.render();
  assert.equal(app.presses.find((press) => press.testID === 'floating-nav-profile').accessibilityState?.selected, true);
  app.environment.keyboardVisible = true;
  const html = app.render();
  assert.equal(app.presses.length, 0);
  assert.equal(html, '');
});

test('HeroUI Tabs selection follows the route while camera remains an action', () => {
  const app = navigationHarness();
  app.render();
  assert.equal(app.presses.find((press) => press.testID === 'floating-nav-home')['aria-selected'], true);
  app.environment.pathname = '/profile';
  app.render();
  assert.equal(app.presses.find((press) => press.testID === 'floating-nav-profile')['aria-selected'], true);
  assert.equal(app.presses.find((press) => press.testID === 'floating-nav-home')['aria-selected'], false);
  assert.equal(app.presses.find((press) => press.testID === 'floating-nav-camera')['aria-selected'], undefined);
  assert.equal(app.animations.length, 0);
});

test('cancelled tab events prevent navigation and modal/detail routes expose no bottom controls', () => {
  const app = navigationHarness();
  const intercepted = [];
  app.render(undefined, { onTabPress: (item) => { intercepted.push(item.id); return false; } });
  app.presses.find((entry) => entry.testID === 'floating-nav-profile').onPress();
  assert.deepEqual(intercepted, ['profile']);
  assert.deepEqual(app.routes, []);
  for (const pathname of ['/scan', '/scan/recent', '/garment/local-id']) {
    app.environment.pathname = pathname;
    assert.equal(app.render(), '');
    assert.equal(app.presses.length, 0);
  }
});

for (const platform of ['ios', 'android']) {
  test(`keyboard visibility hook uses ${platform} native events and removes both listeners`, () => {
    const listeners = new Map();
    const removed = [];
    let state;
    let effect;
    const { useKeyboardVisible } = loadTs('src/hooks/useKeyboardVisible.ts', {
      react: {
        useState(initial) {
          if (state === undefined) state = typeof initial === 'function' ? initial() : initial;
          return [state, (next) => { state = next; }];
        },
        useEffect(callback) { effect = callback; },
      },
      'react-native': {
        Platform: { OS: platform },
        Keyboard: {
          isVisible: () => false,
          addListener(event, callback) {
            listeners.set(event, callback);
            return { remove() { removed.push(event); listeners.delete(event); } };
          },
        },
      },
    });
    assert.equal(useKeyboardVisible(), false);
    const cleanup = effect();
    const prefix = platform === 'ios' ? 'keyboardWill' : 'keyboardDid';
    assert.deepEqual([...listeners.keys()], [`${prefix}Show`, `${prefix}Hide`]);
    listeners.get(`${prefix}Show`)();
    assert.equal(useKeyboardVisible(), true);
    listeners.get(`${prefix}Hide`)();
    assert.equal(useKeyboardVisible(), false);
    cleanup();
    assert.equal(removed.length, 2);
    assert.equal(listeners.size, 0);
  });
}
