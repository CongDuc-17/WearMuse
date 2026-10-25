const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadTsx } = require('./helpers/load-tsx.cjs');

/** Render the installed HeroUI component after native layout has measured its width.
 * Device animation hooks are replaced; the real shimmer/pulse render branch is kept.
 */
function harness(reducedMotion) {
  const animationContext = React.createContext(null);
  const rootCalls = [];
  const views = [];
  function NativeView(props) {
    views.push(props);
    return React.createElement('div', { 'data-testid': props.testID }, props.children);
  }
  const { default: Skeleton } = loadTsx('node_modules/heroui-native/src/components/skeleton/skeleton.tsx', {
    react: {
      ...React,
      // Reproduce the second render after onLayout: width > 0 mounts shimmer.
      useState: () => [160, () => {}],
    },
    'react-native': { StyleSheet: { absoluteFill: {} }, useWindowDimensions: () => ({ width: 375 }) },
    'react-native-reanimated': { __esModule: true, default: { View: NativeView }, useSharedValue: () => ({ value: 0 }) },
    '../../helpers/internal/contexts': { AnimationSettingsProvider: ({ children }) => children },
    './skeleton.animation': {
      SkeletonAnimationProvider: ({ value, children }) => React.createElement(animationContext.Provider, { value }, children),
      useSkeletonAnimation: () => React.useContext(animationContext),
      useSkeletonRootAnimation: (options) => { rootCalls.push(options); return { isAllAnimationsDisabled: options.animation === 'disable-all' }; },
      useSkeletonPulseAnimation: () => ({ rContainerStyle: { opacity: 1 } }),
      useSkeletonShimmerAnimation: () => { throw new Error('Shimmer hook mounted after layout'); },
    },
    './linear-gradient': { __esModule: true, default: () => { throw new Error('Shimmer gradient mounted'); } },
    './skeleton.constants': { DISPLAY_NAME: { SKELETON: 'Skeleton' } },
    './skeleton.styles': { skeletonClassNames: { root: () => 'skeleton' }, skeletonStyleSheet: { borderCurve: {} } },
  });
  const { LoadingSkeleton } = loadTsx('src/components/LoadingSkeleton.tsx', {
    'heroui-native': { Skeleton },
    '@/hooks/useReducedMotion': { useReducedMotion: () => reducedMotion },
  });
  return { Skeleton, LoadingSkeleton, rootCalls, views };
}

test('regression harness exercises the real HeroUI shimmer branch after layout', () => {
  const { Skeleton } = harness(false);
  assert.throws(() => renderToStaticMarkup(React.createElement(Skeleton)), /Shimmer hook mounted after layout/);
});

for (const reducedMotion of [false, true]) {
  test('loading placeholder renders after layout with reduced motion ' + reducedMotion, () => {
    const app = harness(reducedMotion);
    const style = { width: 156, height: 210, borderRadius: 24 };
    const html = renderToStaticMarkup(React.createElement(app.LoadingSkeleton, { style, testID: 'loading-card' }));
    assert.match(html, /loading-card/);
    assert.equal(app.rootCalls[0].isLoading, true);
    assert.equal(app.rootCalls[0].variant, reducedMotion ? 'none' : 'pulse');
    assert.equal(app.rootCalls[0].animation, reducedMotion ? 'disable-all' : undefined);
    const root = app.views.find((view) => view.testID === 'loading-card');
    const flatten = (value) => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value;
    assert.deepEqual(flatten(root.style), style);
  });
}
