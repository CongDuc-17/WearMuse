require('./load-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diagnosticError, logDiagnostic, sanitizeDiagnosticMessage } = require('../src/services/diagnostics/logger.ts');
const { loadGarmentsApi } = require('./helpers/expo-form-data.cjs');
const { ApiClient, ApiError, GarmentsApi } = loadGarmentsApi(class NativeFile {});

test('diagnostics retain native failure context while redacting URIs, paths and credentials', () => {
  const message = "signal.throwIfAborted is not a function; source 'file:///private/device/My Image.jpg'; "
    + 'request https://api.example.test/items?token=secret; /Users/person/Documents/photo.jpg; '
    + 'Bearer private-token; password=hidden; C:\\Users\\person\\secret.png';
  const safe = sanitizeDiagnosticMessage(message);
  assert.match(safe, /signal\.throwIfAborted is not a function/);
  for (const secret of ['file://', 'https://', '/Users/', 'My Image.jpg', 'private-token', 'hidden', 'C:\\Users']) {
    assert.equal(safe.includes(secret), false, secret);
  }
  const wrapped = new ApiError('Không thể gửi ảnh.', 'network', true, null, new TypeError('Native request failed at file:///private/photo.jpg'));
  const details = diagnosticError(wrapped);
  assert.equal(details.kind, 'network'); assert.equal(details.retryable, true);
  assert.equal(details.causeName, 'TypeError'); assert.equal(details.causeMessage, 'Native request failed at [uri]');
});

test('structured diagnostics are disabled outside development', () => {
  const oldDev = global.__DEV__; const original = console.info; const messages = [];
  console.info = (...args) => messages.push(args);
  try {
    global.__DEV__ = false; logDiagnostic('preparing_image', { localId: 'local-safe' });
    assert.equal(messages.length, 0);
    global.__DEV__ = true; logDiagnostic('preparing_image', { localId: 'local-safe', message: 'read file:///private/source.jpg' });
    assert.deepEqual(messages, [['[WearMuseMeow] preparing_image', '{"localId":"local-safe","message":"read [uri]"}']]);
  } finally { global.__DEV__ = oldDev; console.info = original; }
});

test('a native preparation failure reports its stage and safe local ID before any HTTP request', async () => {
  const oldDev = global.__DEV__; const original = console.info; const messages = [];
  global.__DEV__ = true; console.info = (...args) => messages.push(args);
  try {
    let requests = 0;
    const client = new ApiClient('http://ai.local:8000', async () => { requests++; return Response.json({}); });
    const api = new GarmentsApi(client, async () => { throw new TypeError('signal.throwIfAborted is not a function file:///private/photo.jpg'); });
    await assert.rejects(api.upload({ localId: 'local-safe' }), TypeError);
    assert.equal(requests, 0);
    assert.equal(messages[0][0], '[WearMuseMeow] preparing_image');
    const failure = messages.find(([label]) => label === '[WearMuseMeow] upload_error');
    const details = JSON.parse(failure[1]);
    assert.equal(details.localId, 'local-safe'); assert.equal(details.phase, 'preparing_image');
    assert.equal(details.errorName, 'TypeError'); assert.match(details.message, /throwIfAborted/);
    assert.equal(JSON.stringify(messages).includes('file:///private'), false);
    assert.equal(messages.some(([label]) => label === '[WearMuseMeow] request_started'), false);
  } finally { global.__DEV__ = oldDev; console.info = original; }
});
