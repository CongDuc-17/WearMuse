const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const { validateApiConfiguration } = loadTs('src/config/env.ts');

test('AI configuration permits HTTPS and requires explicit opt-in for private HTTP', () => {
  assert.equal(validateApiConfiguration('https://ai.example.test', false), null);
  for (const host of ['10.0.2.2', '192.168.1.10', '172.16.2.5', 'localhost', '127.0.0.1', '[::1]', 'wardrobe.local']) {
    assert.equal(validateApiConfiguration(`http://${host}:8000`, true), null, host);
    assert.ok(validateApiConfiguration(`http://${host}:8000`, false), host);
  }
  for (const host of ['10.attacker.com', '192.168.example.com', '8.8.8.8', '172.32.0.1']) {
    assert.ok(validateApiConfiguration(`http://${host}:8000`, true), host);
  }
  for (const value of ['', 'bad url', 'file:///private', 'https://user:secret@example.test', 'https://example.test?token=secret']) {
    assert.ok(validateApiConfiguration(value, true));
  }
});

test('native configuration defaults to secure transport and blocks production HTTP opt-in', () => {
  const config = loadTs('app.config.ts').default;
  const previous = Object.fromEntries(['EXPO_PUBLIC_ALLOW_LOCAL_HTTP', 'EAS_BUILD_PROFILE', 'EXPO_PUBLIC_API_BASE_URL'].map((key) => [key, process.env[key]]));
  try {
    delete process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP;
    delete process.env.EAS_BUILD_PROFILE;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    const secure = config({ config: { name: 'test', slug: 'test' } });
    assert.equal(secure.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
    assert.equal(secure.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties')[1].android.usesCleartextTraffic, false);
    process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP = 'true';
    const development = config({ config: { name: 'test', slug: 'test' } });
    assert.equal(development.ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking, true);
    process.env.EAS_BUILD_PROFILE = 'production';
    assert.throws(() => config({ config: { name: 'test', slug: 'test' } }), /production/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
