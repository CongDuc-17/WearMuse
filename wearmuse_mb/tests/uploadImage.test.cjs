const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./helpers/load-ts.cjs');
const { installExpoFormData, normalizeBodyInitAsync, convertFormDataAsync } = require('./helpers/expo-form-data.cjs');
const { AbortController: ReactNativeAbortController } = require('abort-controller/dist/abort-controller');

function harness(options = {}) {
  const originalUri = 'file:///documents/wearmuse-garments-v1/photo/original.heic';
  const original = { bytes: new Uint8Array([0, 0, 0, 12]), width: options.width ?? 4032, height: options.height ?? 3024 };
  const files = new Map([[originalUri, original]]);
  const directories = new Set(['file:///documents', 'file:///documents/wearmuse-garments-v1/photo']);
  const events = [];
  let savedSequence = 0;
  let storage;
  const join = (parts) => parts.map((part) => typeof part === 'string' ? part : part.uri)
    .map((part, index) => index ? part.replace(/^\/+|\/+$/g, '') : part.replace(/\/+$/g, '')).join('/');
  class Directory {
    constructor(...parts) { this.uri = join(parts); }
    get exists() { return directories.has(this.uri); }
    create() { directories.add(this.uri); }
    delete() {
      for (const uri of files.keys()) if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
      directories.delete(this.uri);
    }
  }
  class File {
    constructor(...parts) { this.uri = join(parts); }
    // Match expo-file-system: name/type are getter-only metadata, and bytes() supplies multipart content.
    get name() { return this.uri.split('/').at(-1); }
    get type() { return this.uri.endsWith('.jpg') ? 'image/jpeg' : 'image/heic'; }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.bytes.length ?? 0; }
    async bytes() { return files.get(this.uri).bytes; }
    async copy(destination) {
      events.push('copy');
      if (options.diskFailure) throw new Error('disk full');
      files.set(destination.uri, files.get(this.uri));
    }
    async move(destination) {
      events.push('promote');
      files.set(destination.uri, files.get(this.uri)); files.delete(this.uri); this.uri = destination.uri;
      if (options.deleteDuringMove) await storage.removeGarmentFiles('photo');
    }
    delete() { files.delete(this.uri); }
  }
  const Image = { async loadAsync(uri) {
    const file = files.get(uri);
    if (!file) throw new Error('decode missing file');
    events.push('verify');
    return { width: file.width, height: file.height, release() { events.push('release-decoder'); } };
  } };
  storage = loadTs('src/services/storage/files.ts', {
    'expo-file-system': { Directory, File, Paths: { document: new Directory('file:///documents') } },
    'expo-image': { Image },
  });
  const diagnostics = loadTs('src/services/diagnostics/logger.ts');
  const apiErrors = loadTs('src/services/api/client.ts', { '../diagnostics/logger': diagnostics });
  const { GarmentsApi } = loadTs('src/services/api/garments.ts', {
    './client': apiErrors, '../diagnostics/logger': diagnostics, 'expo-file-system': { File },
  });
  const module = loadTs('src/services/storage/uploadImage.ts', {
    'expo-file-system': { File }, 'expo-image': { Image }, './files': storage,
    '../api/client': apiErrors,
    'expo-image-manipulator': {
      SaveFormat: { JPEG: 'jpeg' },
      ImageManipulator: { manipulate(uri) {
        assert.equal(uri, originalUri);
        events.push('manipulate');
        let width = original.width;
        let height = original.height;
        return {
          resize(size) {
            events.push(`resize:${JSON.stringify(size)}`);
            const ratio = size.width ? size.width / width : size.height / height;
            width = Math.round(width * ratio); height = Math.round(height * ratio);
          },
          async renderAsync() {
            events.push('render');
            if (options.invalidDecode) throw new Error('unsupported HEIC decoder');
            if (options.abortDuringRender) options.abortDuringRender.abort();
            return {
              width, height,
              async saveAsync(saveOptions) {
                events.push('save');
                assert.deepEqual(saveOptions, { format: 'jpeg', compress: 0.85 });
                const uri = `file:///cache/generated-${savedSequence++}.jpg`;
                files.set(uri, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), width, height });
                return { uri, width, height };
              },
              release() { events.push('release-render'); },
            };
          },
          release() { events.push('release-context'); },
        };
      } },
    },
  });
  const garment = {
    localId: 'photo', originalLocalUri: originalUri, mimeType: 'image/heic', fileName: 'original.heic',
  };
  return { ...module, storage, garment, original, files, events, ApiError: apiErrors.ApiError, ApiClient: apiErrors.ApiClient, GarmentsApi, File };
}

test('a high-resolution HEIC becomes a <=1600px persistent JPEG while original metadata/file remain intact', async () => {
  const app = harness();
  const before = { ...app.garment };
  const upload = await app.prepareUploadImage(app.garment);
  assert.notEqual(upload, app.garment);
  assert.deepEqual(app.garment, before);
  assert.equal(app.files.get(app.garment.originalLocalUri), app.original);
  assert.equal(upload.originalLocalUri, 'file:///documents/wearmuse-garments-v1/photo/upload.jpg');
  assert.equal(upload.mimeType, 'image/jpeg');
  assert.equal(upload.fileName, 'upload.jpg');
  assert.deepEqual(app.files.get(upload.originalLocalUri), {
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), width: 1600, height: 1200,
  });
  assert.equal(app.events.filter((event) => event === 'release-render').length, 2);
  assert.equal(app.events.filter((event) => event === 'release-context').length, 1);
  assert.equal([...app.files.keys()].some((uri) => uri.startsWith('file:///cache/')), false);
});

test('a verified upload JPEG is reused on retry without another manipulation', async () => {
  const app = harness();
  const first = await app.prepareUploadImage(app.garment);
  const second = await app.prepareUploadImage(app.garment);
  assert.equal(first.originalLocalUri, second.originalLocalUri);
  assert.equal(app.events.filter((event) => event === 'manipulate').length, 1);
});

test('a small portrait image is encoded without upscaling', async () => {
  const app = harness({ width: 600, height: 800 });
  const upload = await app.prepareUploadImage(app.garment);
  assert.equal(app.events.some((event) => event.startsWith('resize:')), false);
  assert.equal(app.files.get(upload.originalLocalUri).width, 600);
  assert.equal(app.files.get(upload.originalLocalUri).height, 800);
});

test('unsupported decoding is permanent invalid_image, disk write failure remains transient', async () => {
  const unsupported = harness({ invalidDecode: true });
  await assert.rejects(unsupported.prepareUploadImage(unsupported.garment), (error) => {
    assert.ok(error instanceof unsupported.ApiError);
    return error.kind === 'invalid_image' && error.retryable === false && error.cause.message === 'unsupported HEIC decoder';
  });
  assert.ok(unsupported.files.has(unsupported.garment.originalLocalUri));
  assert.ok(unsupported.events.includes('release-context'));
  const full = harness({ diskFailure: true });
  await assert.rejects(full.prepareUploadImage(full.garment), (error) => !(error instanceof full.ApiError) && error.message === 'disk full');
  assert.equal(full.files.size, 1);
  assert.ok(full.events.includes('release-context'));
});

test('cancellation releases native references without promoting a derivative', async () => {
  const controller = new AbortController();
  const app = harness({ abortDuringRender: controller });
  await assert.rejects(app.prepareUploadImage(app.garment, controller.signal), { name: 'AbortError' });
  assert.equal(app.files.size, 1);
  assert.ok(app.events.includes('release-context'));
  assert.ok(app.events.includes('release-render'));
});

test('deletion during native promotion cleans the derivative and prevents later folder recreation', async () => {
  const app = harness({ deleteDuringMove: true });
  await assert.rejects(app.prepareUploadImage(app.garment), { name: 'AbortError' });
  assert.equal(app.files.size, 0);
  await assert.rejects(app.prepareUploadImage(app.garment), { name: 'AbortError' });
  assert.equal(app.events.filter((event) => event === 'manipulate').length, 1);
});

test('upload preparation accepts the exact React Native AbortSignal polyfill without throwIfAborted', async () => {
  const app = harness();
  const controller = new ReactNativeAbortController();
  assert.equal(typeof controller.signal.throwIfAborted, 'undefined');
  const upload = await app.prepareUploadImage(app.garment, controller.signal);
  assert.equal(upload.fileName, 'upload.jpg');
  assert.equal(app.files.has(app.garment.originalLocalUri), true);
});

test('React Native AbortSignal cancellation during normalization stays AbortError', async () => {
  const controller = new ReactNativeAbortController();
  const app = harness({ abortDuringRender: controller });
  await assert.rejects(app.prepareUploadImage(app.garment, controller.signal), { name: 'AbortError' });
  assert.equal(app.files.size, 1);
  assert.ok(app.events.includes('release-context'));
});

test('the API upload survives actual Expo 57 multipart conversion before POST 202 and preserves the original', async () => {
  const originalController = globalThis.AbortController;
  const restoreFormData = installExpoFormData();
  globalThis.AbortController = ReactNativeAbortController;
  try {
    const app = harness();
    const before = { ...app.garment };
    const requests = [];
    const api = new app.GarmentsApi(new app.ApiClient('http://192.168.1.2:8000', async (url, options) => {
      // Exercise the same installed SDK implementation that runs before Expo's native HTTP request.
      // A legacy URI descriptor throws here, rather than receiving an unconditional fake success.
      const wire = await normalizeBodyInitAsync(options.body);
      requests.push({ url, options, wire });
      return { ok: true, status: 202, json: async () => ({
        id: 'server-photo', status: 'queued', original_url: '/v1/items/server-photo/assets/original',
        cutout_url: null, thumbnail_url: null,
      }) };
    }), app.prepareUploadImage);
    const controller = new ReactNativeAbortController();
    assert.equal(typeof controller.signal.throwIfAborted, 'undefined');
    const response = await api.upload(app.garment, controller.signal);
    assert.equal(response.id, 'server-photo');
    assert.equal(response.status, 'queued');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://192.168.1.2:8000/v1/items');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(typeof requests[0].options.signal.throwIfAborted, 'undefined');
    assert.equal(requests[0].options.signal.aborted, false);
    const uploadPart = requests[0].options.body.get('file');
    assert.ok(uploadPart instanceof app.File);
    assert.equal(uploadPart.uri, 'file:///documents/wearmuse-garments-v1/photo/upload.jpg');
    assert.equal(uploadPart.name, 'upload.jpg');
    assert.equal(uploadPart.type, 'image/jpeg');
    assert.equal(Object.getOwnPropertyDescriptor(app.File.prototype, 'name').set, undefined);
    const contentType = requests[0].wire.overriddenHeaders.find(([key]) => key.toLowerCase() === 'content-type')[1];
    assert.match(contentType, /^multipart\/form-data; boundary=----ExpoFetchFormBoundary[\w]{16}$/);
    const multipart = new TextDecoder().decode(requests[0].wire.body);
    assert.match(multipart, /content-disposition: form-data; name="file"; filename="upload\.jpg"\r\n/);
    assert.match(multipart, /content-type: image\/jpeg\r\n/);
    assert.equal(Object.keys(requests[0].options.headers).some((key) => key.toLowerCase() === 'content-type'), false);
    assert.deepEqual(app.garment, before);
    assert.equal(app.files.get(app.garment.originalLocalUri), app.original);
    const derivative = app.files.get(uploadPart.uri);
    assert.deepEqual([derivative.width, derivative.height], [1600, 1200]);
    assert.ok(Buffer.from(requests[0].wire.body).includes(Buffer.from(derivative.bytes)), 'encoded multipart contains the actual JPEG bytes');
  } finally {
    globalThis.AbortController = originalController;
    restoreFormData();
  }
});

test('actual Expo 57 multipart conversion rejects the legacy URI object that caused the device failure', async () => {
  const restore = installExpoFormData();
  try {
    const form = new FormData();
    form.append('file', { uri: 'file:///documents/upload.jpg', name: 'upload.jpg', type: 'image/jpeg' });
    await assert.rejects(normalizeBodyInitAsync(form), /Unsupported FormDataPart implementation/);
  } finally { restore(); }
});

test('actual Expo FormData patch preserves getter-only native File metadata with the optional filename argument', async () => {
  const restore = installExpoFormData();
  try {
    const app = harness();
    const prepared = await app.prepareUploadImage(app.garment);
    const file = new app.File(prepared.originalLocalUri);
    assert.equal(file instanceof Blob, false, 'Expo filesystem File implements the Blob interface without extending Blob');
    const form = new FormData();
    assert.doesNotThrow(() => form.append('file', file, 'upload.jpg'));
    assert.equal(file.name, 'upload.jpg');
    const encoded = await convertFormDataAsync(form, 'sdk57-boundary');
    assert.match(new TextDecoder().decode(encoded.body), /filename="upload\.jpg"\r\ncontent-type: image\/jpeg/);
  } finally { restore(); }
});
