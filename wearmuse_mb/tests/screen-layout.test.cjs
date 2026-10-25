const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadTs } = require('./helpers/load-ts.cjs');
const { loadTsx } = require('./helpers/load-tsx.cjs');

function screenHarness(cameraGranted = true) {
  const safeAreas = [];
  const flatten = (style) => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {};
  const resolve = (className = '') => ({
    ...(className.split(' ').includes('flex-1') ? { flex: 1 } : {}),
    ...(className.split(' ').includes('bg-background') ? { backgroundColor: '#000000' } : {}),
  });
  const View = ({ children }) => React.createElement('div', null, children);
  // Unlike RN's built-in View, a third-party native view ignores className.
  const NativeSafeAreaView = (props) => { safeAreas.push(props); return React.createElement(View, props); };
  const { withUniwind } = loadTsx('node_modules/uniwind/src/hoc/withUniwind.native.tsx', {
    '../common/utils': { isDefined: (value) => value != null },
    '../core/context': { useUniwindContext: () => ({}) },
    '../core/listener': { UniwindListener: { getSnapshot: () => 0, subscribe: () => () => {} } },
    '../core/logger': { Logger: { warn() {} } },
    '../core/native': { UniwindStore: { getStyles: (className) => ({ styles: resolve(className), dependencies: [] }) } },
    './withUniwindUtils': loadTs('node_modules/uniwind/src/hoc/withUniwindUtils.ts'),
  });
  const safeArea = { SafeAreaView: NativeSafeAreaView, useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) };
  const styledSafeArea = loadTsx('src/components/SafeAreaView.tsx', {
    'react-native-safe-area-context': safeArea, uniwind: { withUniwind },
  });
  const slots = Object.assign(View, { Header: View, Body: View, Footer: View, Title: View, Description: View, Label: View, Content: View, Indicator: View });
  const mocks = {
    'react-native': {
      View, Text: View, ScrollView: View, Platform: { OS: 'ios' },
      FlatList: ({ ListHeaderComponent, ListEmptyComponent }) => React.createElement(View, null, ListHeaderComponent, ListEmptyComponent),
      useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }),
      AppState: { currentState: 'active' }, StyleSheet: { create: (styles) => styles, absoluteFill: {} },
    },
    'react-native-safe-area-context': safeArea,
    '@/components/SafeAreaView': styledSafeArea,
    'heroui-native': { Alert: slots, Card: slots, Chip: slots, Tabs: slots, Spinner: View, Surface: View },
    uniwind: { ScopedTheme: ({ children }) => children },
    'expo-router': { router: {}, useFocusEffect() {}, useIsFocused: () => true },
    'expo-status-bar': { StatusBar: () => null },
    'expo-camera': { CameraView: View, useCameraPermissions: () => [{ granted: cameraGranted, status: cameraGranted ? 'granted' : 'denied', canAskAgain: true }, () => {}, () => {}] },
    'expo-image': { Image: View }, 'expo-image-picker': {},
    '@/components/Button': { Button: ({ title }) => React.createElement('button', null, title), IconButton: View },
    '@/components/CaptureButton': { CaptureButton: View },
    '@/components/GarmentCard': { GarmentCard: View },
    '@/components/Icon': { Icon: View }, '@/components/LoadingSkeleton': { LoadingSkeleton: View },
    '@/constants/tokens': loadTs('src/constants/tokens.ts'),
    '@/features/wardrobe/presentation': loadTs('src/features/wardrobe/presentation.ts'),
    '@/features/runtime/RuntimeProvider': { useRuntime: () => ({ ready: true, error: null, configurationError: null }) },
    '@/hooks/useWardrobeCollection': { useWardrobeCollection: () => ({ garments: [], loading: false, error: null, reload() {} }) },
    '@/hooks/useReducedMotion': { useReducedMotion: () => true },
    '@/services/camera/capture': { savePhoto() {} },
  };
  return {
    render(file) {
      const Screen = loadTsx(file, mocks).default;
      const html = renderToStaticMarkup(React.createElement(Screen));
      assert.equal(safeAreas.length, 1);
      assert.equal(flatten(safeAreas[0].style).flex, 1, 'native safe-area container must fill the screen so its flex children cannot collapse');
      return html;
    },
  };
}

test('iOS closet forwards its full-height style to the native safe-area view', () => {
  const html = screenHarness().render('src/app/(tabs)/index.tsx');
  assert.match(html, /Tủ đồ/);
  assert.match(html, /Thêm món đồ đầu tiên/);
});

for (const granted of [true, false]) {
  test('iOS camera safe-area fills the screen with camera permission ' + granted, () => {
    const html = screenHarness(granted).render('src/app/scan.tsx');
    assert.match(html, granted ? /Đặt trọn món đồ trong khung/ : /Cho phép dùng camera/);
  });
}
