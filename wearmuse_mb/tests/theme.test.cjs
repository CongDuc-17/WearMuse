const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { loadTs } = require('./helpers/load-ts.cjs');
const { loadTsx } = require('./helpers/load-tsx.cjs');
const { colorMix } = loadTs('node_modules/uniwind/src/core/native/native-utils.ts');

// Compile with the installed Uniwind/Tailwind native pipeline; only replace the
// subsequent JS worker, so no device runtime is required to inspect CSS tokens.
test('default HeroUI colors and the library theme survive iOS CSS compilation', async () => {
  let generated;
  const { transform } = loadTsx('node_modules/uniwind/dist/metro/transformer.cjs', {
    '@expo/metro-config': { unstable_transformerPath: '__native_css_test_worker__' },
    '__native_css_test_worker__': { transform: async (_config, _root, _file, data) => {
      generated = data.toString();
      return { output: [{ data: {} }] };
    } },
  });
  await transform({ uniwind: { cssEntryFile: './global.css', dtsFile: './src/uniwind-types.d.ts', isExpoProject: true } },
    process.cwd(), 'global.css', fs.readFileSync('global.css'), { type: 'module', platform: 'ios', dev: false });
  const { UNIWIND_THEME_VARIABLES } = loadTs('node_modules/uniwind/src/common/consts.ts');
  const tokens = ['background', 'foreground', 'surface-secondary', 'accent-foreground', 'default-foreground',
    'danger-soft-foreground', 'accent-soft-foreground', 'success-soft-foreground', 'warning-soft-foreground'];
  let verified = 0;
  vm.runInNewContext(generated, { require(name) {
    assert.equal(name, 'uniwind');
    return { Uniwind: { __reinit(factory) {
      for (const theme of ['light', 'dark']) {
        const metadata = factory({ theme, colorScheme: theme, colorMix });
        const variables = { ...metadata.vars, ...metadata.scopedVars[UNIWIND_THEME_VARIABLES + theme] };
        assert.equal(variables['--theme'](variables), 'default');
        for (const token of tokens) {
          const name = '--color-' + token;
          assert.equal(typeof variables[name], 'function', theme + ': missing ' + name);
          const value = variables[name](variables);
          assert.equal(typeof value, 'string', theme + ': unresolved ' + name);
          assert.ok(value.length > 0 && value !== 'invalid', theme + ': invalid ' + name);
          assert.doesNotMatch(value, /var\(|color-mix\(/, theme + ': unresolved CSS expression in ' + name);
        }
        verified += 1;
      }
    } } };
  } });
  assert.equal(verified, 2);
});
