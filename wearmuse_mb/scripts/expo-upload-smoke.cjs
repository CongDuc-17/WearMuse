// Called by backend-smoke.py against its isolated temporary FastAPI server.
// Runs the app API and the installed Expo multipart serializer over real HTTP.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { AbortController: ReactNativeAbortController } = require('abort-controller/dist/abort-controller');
const { installExpoFormData, loadGarmentsApi, normalizeBodyInitAsync } = require('../tests/helpers/expo-form-data.cjs');

async function main() {
  const [baseUrl, filename] = process.argv.slice(2);
  const url = new URL(baseUrl);
  assert.equal(url.hostname, '127.0.0.1', 'This test only targets the isolated loopback server.');
  assert.equal(url.protocol, 'http:');
  const localFile = path.resolve(filename);
  const expectedBytes = await fs.readFile(localFile);
  const originalFetch = globalThis.fetch;
  const restoreFormData = installExpoFormData();
  let requests = 0;
  let acceptedId;
  // Native file reads are supplied by Node; Expo's actual serializer receives the
  // same File.name/type/bytes interface as expo-file-system on the phone.
  class DiskFile {
    constructor(uri) { this.uri = uri; }
    get name() { return path.basename(fileURLToPath(this.uri)); }
    get type() { return 'image/jpeg'; }
    async bytes() { return new Uint8Array(await fs.readFile(fileURLToPath(this.uri))); }
  }
  try {
    const { ApiClient, GarmentsApi } = loadGarmentsApi(DiskFile);
    const transport = async (requestUrl, options) => {
      requests++;
      assert.equal(requestUrl, `${baseUrl}/v1/items`);
      assert.equal(options.method, 'POST');
      assert.equal(Object.keys(options.headers).some((key) => key.toLowerCase() === 'content-type'), false);
      assert.equal(options.signal.aborted, false);
      assert.equal(options.headers['Idempotency-Key'], source.localId);
      const encoded = await normalizeBodyInitAsync(options.body);
      const headers = new Headers(options.headers);
      for (const [name, value] of encoded.overriddenHeaders ?? []) headers.set(name, value);
      assert.match(headers.get('content-type'), /^multipart\/form-data; boundary=----ExpoFetchFormBoundary/);
      const wire = Buffer.from(encoded.body);
      assert.ok(wire.includes(Buffer.from('name="file"')));
      assert.ok(wire.includes(expectedBytes));
      const response = await originalFetch(requestUrl, { ...options, body: encoded.body, headers });
      if (requests === 1) {
        assert.equal(response.status, 202);
        acceptedId = (await response.json()).id;
        throw new TypeError('Simulated response loss after the server committed the upload');
      }
      return response;
    };
    const source = Object.freeze({
      localId: 'expo-http-smoke', remoteId: null,
      originalLocalUri: pathToFileURL(localFile).href,
      fileName: path.basename(localFile), mimeType: 'image/jpeg',
    });
    const mobileSignal = new ReactNativeAbortController().signal;
    assert.equal(typeof mobileSignal.throwIfAborted, 'undefined');
    // ApiClient links this mobile caller signal to Node's controller for Node HTTP.
    // The fully native-controller path is covered by uploadImage.test.cjs.
    await assert.rejects(new GarmentsApi(new ApiClient(baseUrl, transport)).upload(source, mobileSignal),
      (error) => error.kind === 'network' && error.retryable);
    const result = await new GarmentsApi(new ApiClient(baseUrl, transport)).upload(source, mobileSignal);
    assert.equal(requests, 2);
    assert.equal(result.id, acceptedId);
    assert.equal(result.status, 'queued');
    assert.ok(result.id);
    process.stdout.write(JSON.stringify(result));
  } finally {
    restoreFormData();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n${error.cause?.stack ?? ''}\n`);
  process.exitCode = 1;
});
