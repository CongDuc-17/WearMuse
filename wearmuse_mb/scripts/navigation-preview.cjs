const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const NativeWeb = require('react-native-web');
const { loadTs } = require('../tests/helpers/load-ts.cjs');
const { loadTsx } = require('../tests/helpers/load-tsx.cjs');

const config = loadTs('src/config/navigation.ts');
const layout = loadTs('src/components/navigation/layout.ts');
const tokens = loadTs('src/constants/tokens.ts', { 'react-native': NativeWeb });
const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json');
const font = fs.readFileSync(require.resolve('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf')).toString('base64');

function FeatherGlyph({ name, size, color, accessible }) {
  return React.createElement(NativeWeb.Text, {
    accessible, style: { fontFamily: 'PreviewFeather', fontSize: size, color, fontWeight: 'normal', fontStyle: 'normal' },
  }, String.fromCodePoint(glyphs[name]));
}

const { Icon } = loadTsx('src/components/Icon.tsx', {
  '@expo/vector-icons/Feather': FeatherGlyph,
  '@/constants/tokens': tokens,
  'heroui-native': { useThemeColor: () => '#11181C' },
});

function createPreview(count, bottom) {
  const native = {
    ...NativeWeb,
    useWindowDimensions: () => ({ width: 320, height: 230, scale: 1, fontScale: 1 }),
  };
  const safeArea = { useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom }) };
  const hook = loadTs('src/hooks/useFloatingNavLayout.ts', {
    'react-native': native, 'react-native-safe-area-context': safeArea,
    '@/components/navigation/layout': layout, '@/config/navigation': config,
  });
  const tabs = loadTsx('node_modules/heroui-native/src/primitives/tabs/tabs.tsx', {
    'react-native': native, '../slot': {},
  });
  const { FloatingBottomNav } = loadTsx('src/components/navigation/FloatingBottomNav.tsx', {
    'react-native': native,
    'expo-router': {
      usePathname: () => bottom ? '/profile' : '/',
      useRouter: () => ({ push() {}, navigate() {} }),
      useFocusEffect() {},
    },
    '@/components/Icon': { Icon }, '@/config/navigation': config,
    '@/hooks/useFloatingNavLayout': hook,
    '@/hooks/useKeyboardVisible': { useKeyboardVisible: () => false },
    '@/hooks/useReducedMotion': { useReducedMotion: () => true },
    'heroui-native': {
      useThemeColor: () => '#11181C',
      Tabs: Object.assign(tabs.Root, { List: tabs.List, Trigger: tabs.Trigger, Indicator: tabs.Indicator }),
    },
  });
  const profile = config.navigationItems.find((item) => item.id === 'profile');
  const fixtures = [...config.navigationItems];
  const extra = [{ id: 'preview-library', label: 'Library', icon: 'bookmark' }, { id: 'preview-settings', label: 'Settings', icon: 'settings' }];
  while (fixtures.length < count) {
    // Preview fixtures reuse an existing route; no extra production screen/menu is created.
    fixtures.push({ ...profile, ...extra[fixtures.length - config.navigationItems.length] });
  }
  return React.createElement('section', { className: 'case', key: `${count}-${bottom}` },
    React.createElement('h2', null, `${count} mục · vùng an toàn ${bottom} px`),
    React.createElement('p', null, bottom ? 'Profile được chọn' : 'Home được chọn'),
    React.createElement(NativeWeb.View, { style: { width: 320, height: 230, backgroundColor: '#F8F5F0', overflow: 'hidden', borderRadius: 22 } },
      React.createElement(NativeWeb.View, { style: { position: 'absolute', top: 28, left: 22 } },
        React.createElement(NativeWeb.Text, { style: { fontSize: 12, letterSpacing: 2, color: '#8B8079' } }, 'WEARMUSEMEOW'),
        React.createElement(NativeWeb.Text, { style: { marginTop: 8, fontSize: 25, color: '#292422', fontWeight: '500' } }, 'Tủ đồ của bạn'),
      ),
      React.createElement(FloatingBottomNav, { items: fixtures }),
      bottom ? React.createElement(NativeWeb.View, { style: { position: 'absolute', bottom: 8, left: 112, width: 96, height: 4, borderRadius: 10, backgroundColor: '#292422' } }) : null,
    ),
  );
}

const cases = [0, 34].flatMap((bottom) => [3, 4, 5].map((count) => createPreview(count, bottom)));
function PreviewApp() {
  return React.createElement('main', null,
    React.createElement('header', null,
      React.createElement('span', { className: 'eyebrow' }, 'ISOLATED COMPONENT PREVIEW'),
      React.createElement('h1', null, 'Floating Bottom Navigation'),
      React.createElement('p', null, 'Component thực tế được render bằng React Native Web ở chiều rộng 320 px. Các mục thứ 4–5 là dữ liệu thử bố cục; ảnh này không đại diện cho toàn bộ ứng dụng.'),
    ),
    React.createElement('div', { className: 'preview-grid' }, cases),
  );
}

NativeWeb.AppRegistry.registerComponent('NavigationPreview', () => PreviewApp);
const { element, getStyleElement } = NativeWeb.AppRegistry.getApplication('NavigationPreview', { initialProps: {} });
const markup = renderToStaticMarkup(element);
const nativeStyles = renderToStaticMarkup(getStyleElement());
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WearMuseMeow navigation preview</title>${nativeStyles}<style>
@font-face{font-family:PreviewFeather;src:url(data:font/ttf;base64,${font}) format('truetype');font-display:block}
*{box-sizing:border-box}body{margin:0;background:#eee9e3;color:#292422;font-family:Arial,sans-serif}main{max-width:1104px;margin:0 auto;padding:34px 24px 40px}header{max-width:720px;margin-bottom:30px}.eyebrow{font-size:10px;letter-spacing:2px;color:#766b62}h1{font-size:30px;font-weight:500;margin:10px 0 12px}header p{font-size:14px;line-height:1.6;color:#706760}.preview-grid{display:grid;grid-template-columns:repeat(3,320px);gap:28px 28px}.case h2{font-size:14px;font-weight:600;margin:0 0 6px}.case p{font-size:12px;color:#756a63;margin:0 0 12px}.case>div{box-shadow:0 6px 22px #48382612;border:1px solid #d8cfc7}@media(max-width:1050px){.preview-grid{grid-template-columns:repeat(2,320px)}}@media(max-width:700px){main{padding:24px 12px}.preview-grid{grid-template-columns:320px;justify-content:center}}
</style></head><body>${markup}</body></html>`;
const outputDirectory = path.resolve(__dirname, '../.test-artifacts/navigation-preview');
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, 'index.html');
fs.writeFileSync(outputPath, html);
console.log(outputPath);
