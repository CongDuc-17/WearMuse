require('./load-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installExpoFormData, loadGarmentsApi, normalizeBodyInitAsync } = require('./helpers/expo-form-data.cjs');
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0xff, 0xd9]);
class NativeFile {
  constructor(uri) { this.uri = uri; }
  get name() { return this.uri.split('/').at(-1); }
  get type() { return this.name.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'; }
  async bytes() { return jpegBytes; }
}
const { ApiClient, ApiError, abortError, GarmentsApi, parseRemoteGarment } = loadGarmentsApi(NativeFile);

test('installed Expo multipart upload serializes native File bytes with generated boundary and file metadata', async () => {
  const restore = installExpoFormData();
  try {
    let received;
    const client = new ApiClient('http://10.0.2.2:8000/', async (url, options) => {
      received = { url, options, normalized: await normalizeBodyInitAsync(options.body) };
      return Response.json({ id: 'remote-1', status: 'queued', future_metadata: { color: 'blue' } }, { status: 202 });
    });
    const item = await new GarmentsApi(client).upload({
      localId: 'local-multipart',
      originalLocalUri: 'file:///documents/original.jpg', fileName: 'original.jpg', mimeType: 'image/jpeg',
    });
    assert.equal(received.url, 'http://10.0.2.2:8000/v1/items');
    const [field, part] = [...received.options.body.entries()][0];
    assert.equal(field, 'file'); assert.ok(part instanceof NativeFile);
    assert.equal(part.uri, 'file:///documents/original.jpg');
    const encoded = Buffer.from(received.normalized.body);
    assert.match(encoded.toString(), /name="file"; filename="original\.jpg"/);
    assert.match(encoded.toString(), /content-type: image\/jpeg/);
    assert.ok(encoded.includes(Buffer.from(jpegBytes)));
    assert.match(received.normalized.overriddenHeaders[0][1], /^multipart\/form-data; boundary=----ExpoFetchFormBoundary/);
    assert.equal(received.options.headers['Content-Type'], undefined);
    assert.equal(received.options.headers['Idempotency-Key'], 'local-multipart');
    assert.deepEqual(item.future_metadata, { color: 'blue' });
  } finally { restore(); }
});

test('response parser normalizes error alias and rejects malformed job contracts', () => {
  assert.equal(parseRemoteGarment({ id: 'a', status: 'error' }).status, 'failed');
  for (const value of [null, [], { id: '', status: 'ready' }, { id: 'a', status: 'mystery' }, { id: 'a', status: 'ready', cutout_url: 42 }]) {
    assert.throws(() => parseRemoteGarment(value), ApiError);
  }
});

test('API classifies invalid images, permanent errors, transient backend and throttling errors', async () => {
  for (const [status, kind, retryable] of [[415, 'invalid_image', false], [413, 'invalid_image', false], [404, 'permanent', false], [503, 'server', true], [429, 'permanent', true], [409, 'permanent', true]]) {
    const client = new ApiClient('http://ai.local:8000', async () => new Response('', { status }));
    await assert.rejects(client.request('/v1/items'), (error) => error instanceof ApiError && error.kind === kind && error.retryable === retryable && error.status === status);
  }
});

test('timeouts are transient and lifecycle aborts remain cancellation', async () => {
  const fetchUntilAbort = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
  const client = new ApiClient('http://ai.local:8000', fetchUntilAbort, 5);
  await assert.rejects(client.request('/v1/items'), (error) => error.kind === 'timeout' && error.retryable);
  const controller = new AbortController();
  const promise = client.request('/v1/items', {}, controller.signal); controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
});

test('missing configuration sends no request; relative assets resolve against API origin', async () => {
  let calls = 0;
  const client = new ApiClient('', async () => { calls++; return Response.json({}); });
  await assert.rejects(client.request('/v1/items'), (error) => error.kind === 'configuration' && !error.retryable);
  assert.equal(calls, 0);
  const configured = new ApiClient('http://192.168.1.5:8000/');
  assert.equal(configured.resolveUrl('/v1/items/a/assets/cutout'), 'http://192.168.1.5:8000/v1/items/a/assets/cutout');
  assert.throws(() => configured.resolveUrl('file:///secret'), ApiError);
});

test('status and retry responses must preserve the requested remote ID', async () => {
  const api = new GarmentsApi(new ApiClient('http://ai.local:8000', async () => Response.json({ id: 'wrong', status: 'queued' })));
  await assert.rejects(api.get('expected'), ApiError);
  await assert.rejects(api.retry('expected'), ApiError);
});

test('upload prepares a JPEG descriptor while keeping original garment identity and source unchanged', async () => {
  const restore = installExpoFormData();
  try {
    const source = Object.freeze({
      localId: 'stable-local-id', remoteId: null, originalLocalUri: 'file:///documents/original.heic',
      fileName: 'original.heic', mimeType: 'image/heic',
    });
    let received;
    const client = new ApiClient('http://ai.local:8000', async (_url, options) => {
      received = [...options.body.entries()];
      await normalizeBodyInitAsync(options.body);
      return Response.json({ id: 'remote-1', status: 'queued' }, { status: 202 });
    });
    const prepare = async (garment) => {
      assert.equal(garment, source);
      return { ...garment, originalLocalUri: 'file:///documents/upload.jpg', fileName: 'upload.jpg', mimeType: 'image/jpeg' };
    };
    await new GarmentsApi(client, prepare).upload(source);
    assert.equal(received[0][0], 'file');
    assert.ok(received[0][1] instanceof NativeFile);
    assert.equal(received[0][1].uri, 'file:///documents/upload.jpg');
    assert.equal(received[0][1].name, 'upload.jpg'); assert.equal(received[0][1].type, 'image/jpeg');
    assert.equal(source.localId, 'stable-local-id');
    assert.equal(source.originalLocalUri, 'file:///documents/original.heic');
  } finally { restore(); }
});

test('cancellation during image preparation prevents upload and passes its signal to preparation', async () => {
  let requests = 0; let preparations = 0; let finish;
  const controller = new AbortController();
  const client = new ApiClient('http://ai.local:8000', async () => { requests++; return Response.json({}); });
  const api = new GarmentsApi(client, async (garment, signal) => {
    preparations++; assert.equal(signal, controller.signal);
    await new Promise((resolve) => { finish = resolve; });
    return garment;
  });
  const work = api.upload({}, controller.signal);
  controller.abort(); finish();
  await assert.rejects(work, { name: 'AbortError' });
  await assert.rejects(api.upload({}, controller.signal), { name: 'AbortError' });
  assert.equal(requests, 0); assert.equal(preparations, 1);
});

test('invalid native image decode remains a permanent image error without a network request', async () => {
  let requests = 0;
  const client = new ApiClient('http://ai.local:8000', async () => { requests++; return Response.json({}); });
  const invalid = new ApiError('Không thể đọc ảnh này. Hãy chọn ảnh khác.', 'invalid_image', false);
  const api = new GarmentsApi(client, async () => { throw invalid; });
  await assert.rejects(api.upload({}), (error) => error === invalid && !error.retryable);
  assert.equal(requests, 0);
});

test('the actual Expo converter rejects legacy URI parts and serialization failures are permanent multipart errors', async () => {
  const restore = installExpoFormData();
  try {
    const form = new FormData();
    form.append('file', { uri: 'file:///documents/upload.jpg', name: 'upload.jpg', type: 'image/jpeg' });
    await assert.rejects(normalizeBodyInitAsync(form), /Unsupported FormDataPart implementation/);
    let networkRequests = 0;
    const client = new ApiClient('http://ai.local:8000', async (_url, options) => {
      await normalizeBodyInitAsync(options.body);
      networkRequests++;
      return Response.json({});
    });
    await assert.rejects(client.request('/v1/items', { method: 'POST', body: form }), (error) => {
      assert.equal(error.kind, 'multipart'); assert.equal(error.retryable, false);
      assert.match(error.message, /tải lại ứng dụng/);
      assert.match(error.cause.message, /Unsupported FormDataPart/);
      return true;
    });
    assert.equal(networkRequests, 0);
  } finally { restore(); }
});

test('upload reuses its original local ID after a lost response and a new API instance', async () => {
  const restore = installExpoFormData();
  try {
    const source = Object.freeze({ localId: 'local-stable-retry', originalLocalUri: 'file:///documents/original.jpg' });
    const accepted = new Map(); let requests = 0;
    const transport = async (_url, options) => {
      requests++;
      const key = options.headers['Idempotency-Key'];
      assert.equal(key, source.localId);
      await normalizeBodyInitAsync(options.body);
      if (!accepted.has(key)) accepted.set(key, { id: 'remote-once', status: 'queued' });
      if (requests === 1) throw new TypeError('simulated lost response');
      return Response.json(accepted.get(key), { status: 202 });
    };
    const prepare = async (garment) => ({ ...garment, originalLocalUri: 'file:///documents/upload.jpg' });
    await assert.rejects(new GarmentsApi(new ApiClient('http://ai.local:8000', transport), prepare).upload(source),
      (error) => error.kind === 'network' && error.retryable);
    const result = await new GarmentsApi(new ApiClient('http://ai.local:8000', transport), prepare).upload(source);
    assert.equal(result.id, 'remote-once');
    assert.equal(requests, 2);
    assert.equal(accepted.size, 1);
    assert.equal(source.originalLocalUri, 'file:///documents/original.jpg');
  } finally { restore(); }
});

test('upload key conflicts stop automatic retries while processing retry conflicts remain recoverable', async () => {
  const restore = installExpoFormData();
  try {
    const api = new GarmentsApi(new ApiClient('http://ai.local:8000', async () => new Response('', { status: 409 })));
    await assert.rejects(api.upload({ localId: 'local-conflict', originalLocalUri: 'file:///documents/original.jpg' }),
      (error) => error instanceof ApiError && error.status === 409 && !error.retryable);
    await assert.rejects(api.retry('existing-remote'),
      (error) => error instanceof ApiError && error.status === 409 && error.retryable);
  } finally { restore(); }
});
