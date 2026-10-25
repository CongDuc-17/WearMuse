require('./load-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ApiError, abortError } = require('../src/services/api/client.ts');
const { UploadQueue } = require('../src/services/queue/uploadQueue.ts');
const { ProcessingPoller } = require('../src/services/queue/processingPoller.ts');
const { SyncEngine } = require('../src/services/queue/syncEngine.ts');
const { backoffMs } = require('../src/services/queue/contracts.ts');
const { loadTs } = require('./helpers/load-ts.cjs');

function garment(localId = 'local-1', patch = {}) {
  return {
    localId, remoteId: null, originalLocalUri: `file:///documents/${localId}/original.jpg`,
    cutoutLocalUri: null, thumbnailLocalUri: null, originalRemoteUrl: null,
    cutoutRemoteUrl: null, thumbnailRemoteUrl: null, mimeType: 'image/jpeg', fileName: 'original.jpg',
    status: 'upload_queued', uploadAttempts: 0, nextAttemptAt: 0, pollAttempts: 0,
    nextPollAt: 0, retryRequested: false, lastError: null,
    createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-15T12:00:00.000Z', ...patch,
  };
}
function remote(id = 'remote-1', status = 'queued', patch = {}) {
  return { id, status, original_url: `/v1/items/${id}/assets/original`,
    cutout_url: status === 'ready' ? `/v1/items/${id}/assets/cutout` : null,
    thumbnail_url: null, error: null, ...patch };
}
function fixture(rows, overrides = {}) {
  const database = new Map(rows.map((row) => [row.localId, structuredClone(row)]));
  const calls = { upload: 0, get: 0, retry: 0, cache: [], removed: [] };
  const repository = {
    async get(id) { return database.has(id) ? structuredClone(database.get(id)) : null; },
    async update(id, patch) { const row = database.get(id); if (!row) return false; Object.assign(row, patch); return true; },
    async getUploadCandidates(now) {
      return [...database.values()].filter((row) => row.nextAttemptAt <= now && (
        (!row.remoteId && ['local_saved', 'upload_queued', 'uploading'].includes(row.status)) || (row.remoteId && row.retryRequested)
      )).map((row) => structuredClone(row));
    },
    async getPollCandidates(now) {
      return [...database.values()].filter((row) => row.remoteId && !row.retryRequested && row.nextPollAt <= now
        && (['uploading', 'queued', 'processing'].includes(row.status) || (row.status === 'ready' && !row.cutoutLocalUri)))
        .map((row) => structuredClone(row));
    },
  };
  const api = {
    async upload() { calls.upload++; return remote(); },
    async get(id) { calls.get++; return remote(id, 'ready'); },
    async retry(id) { calls.retry++; return remote(id); },
    resolveUrl(path) { return new URL(path, 'http://ai.local:8000').toString(); },
    ...overrides,
  };
  let time = 1_000;
  const dependencies = {
    repository, api, now: () => time, locks: new Set(),
    async cacheRemoteAsset(id, url, kind) {
      calls.cache.push({ id, url, kind }); return `file:///documents/${id}/${kind}.png`;
    },
    async removeGarmentFiles(id) { calls.removed.push(id); },
  };
  return { database, calls, dependencies, repository, api, setTime(value) { time = value; } };
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('two consecutive local captures upload independently with stable local IDs and original files', async () => {
  const first = garment(); const second = garment('local-2');
  const f = fixture([first, second]);
  let uploads = 0;
  f.api.upload = async (row) => { uploads++; return remote(`server-${row.localId}`); };
  await new UploadQueue(f.dependencies).drain();
  assert.equal(uploads, 2);
  for (const row of [first, second]) {
    const saved = f.database.get(row.localId);
    assert.equal(saved.localId, row.localId);
    assert.equal(saved.originalLocalUri, row.originalLocalUri);
    assert.equal(saved.remoteId, `server-${row.localId}`);
    assert.equal(saved.status, 'queued');
  }
  // A fresh service instance models application restart; remote rows never upload again.
  await new UploadQueue(f.dependencies).drain();
  assert.equal(uploads, 2);
});

test('upload queue serializes requests even when drain is called concurrently', async () => {
  const gate = deferred(); const entered = deferred();
  const f = fixture([garment(), garment('local-2')]);
  let active = 0; let maximum = 0; let requests = 0;
  f.api.upload = async (row) => {
    requests++; active++; maximum = Math.max(maximum, active);
    entered.resolve(); await gate.promise; active--; return remote(`server-${row.localId}`);
  };
  const queue = new UploadQueue(f.dependencies);
  const first = queue.drain(); await entered.promise;
  await queue.drain(); gate.resolve(); await first;
  assert.equal(requests, 2); assert.equal(maximum, 1);
});

test('temporary backend failure persists retry time and survives a queue restart', async () => {
  const f = fixture([garment()], { async upload() { throw new ApiError('Unavailable', 'server', true, 503); } });
  await new UploadQueue(f.dependencies).drain();
  const saved = f.database.get('local-1');
  assert.equal(saved.status, 'upload_queued'); assert.equal(saved.uploadAttempts, 1);
  assert.equal(saved.nextAttemptAt, 3_000); assert.ok(saved.originalLocalUri);
  f.api.upload = async () => { f.calls.upload++; return remote(); };
  await new UploadQueue(f.dependencies).drain(); assert.equal(f.calls.upload, 0);
  f.setTime(3_000); await new UploadQueue(f.dependencies).drain();
  assert.equal(saved.remoteId, 'remote-1'); assert.equal(f.calls.upload, 1);
});

test('invalid images stop automatically and transient uploads stop after five attempts', async () => {
  const invalid = fixture([garment()], { async upload() { throw new ApiError('Bad image', 'invalid_image', false, 415); } });
  await new UploadQueue(invalid.dependencies).drain();
  assert.equal(invalid.database.get('local-1').status, 'failed');
  assert.equal(invalid.database.get('local-1').uploadAttempts, 1);
  assert.ok(invalid.database.get('local-1').originalLocalUri);
  const transient = fixture([garment()], { async upload() { throw new ApiError('Offline', 'network', true); } });
  for (let i = 0; i < 5; i++) {
    transient.setTime(i * 100_000); await new UploadQueue(transient.dependencies).drain();
  }
  assert.equal(transient.database.get('local-1').status, 'failed');
  assert.equal(transient.database.get('local-1').uploadAttempts, 5);
  assert.equal(backoffMs(100), 60_000);
});

test('background cancellation requeues upload without exhausting its retry allowance', async () => {
  const entered = deferred(); const controller = new AbortController();
  const f = fixture([garment()], {
    upload(_row, signal) {
      entered.resolve();
      return new Promise((_yes, no) => signal.addEventListener('abort', () => no(abortError()), { once: true }));
    },
  });
  const work = new UploadQueue(f.dependencies).drain(controller.signal);
  await entered.promise; controller.abort(); await work;
  const saved = f.database.get('local-1');
  assert.equal(saved.status, 'upload_queued'); assert.equal(saved.uploadAttempts, 0);
});

test('an accepted server ID remains pollable if cancellation races a metadata-write failure', async () => {
  const f = fixture([garment()]);
  const controller = new AbortController();
  const update = f.repository.update;
  let simulatedFailure = false;
  f.repository.update = async (id, patch) => {
    if (patch.status === 'queued' && patch.originalRemoteUrl && !simulatedFailure) {
      simulatedFailure = true; controller.abort(); throw new Error('temporary SQLite write error');
    }
    return update(id, patch);
  };
  await new UploadQueue(f.dependencies).drain(controller.signal);
  const saved = f.database.get('local-1');
  assert.equal(saved.remoteId, 'remote-1'); assert.equal(saved.status, 'queued');
  assert.equal(saved.retryRequested, false); assert.equal((await f.repository.getPollCandidates(1_000)).length, 1);
  await new UploadQueue(f.dependencies).drain(); assert.equal(f.calls.upload, 1);
});

test('a retry uses the existing remote ID; HTTP 409 resynchronizes rather than re-uploading', async () => {
  const f = fixture([garment('local-1', { status: 'failed', remoteId: 'existing', retryRequested: true })], {
    async retry(id) { assert.equal(id, 'existing'); throw new ApiError('Already queued', 'permanent', true, 409); },
    async get(id) { return remote(id, 'processing'); },
  });
  await new UploadQueue(f.dependencies).drain();
  const saved = f.database.get('local-1');
  assert.equal(saved.remoteId, 'existing'); assert.equal(saved.status, 'processing');
  assert.equal(saved.retryRequested, false); assert.equal(f.calls.upload, 0);
});

test('restart during processing fetches and verifies the cutout before replacing the preview', async () => {
  const original = garment('local-1', { remoteId: 'existing', status: 'processing' });
  const f = fixture([original]); const gate = deferred();
  f.dependencies.cacheRemoteAsset = async (_id, url) => {
    assert.equal(url, 'http://ai.local:8000/v1/items/existing/assets/cutout');
    assert.equal(f.database.get('local-1').cutoutLocalUri, null);
    await gate.promise; return 'file:///verified-cutout.png';
  };
  const poller = new ProcessingPoller(f.dependencies);
  const work = poller.tick(); await settle();
  assert.equal(f.database.get('local-1').cutoutLocalUri, null);
  await poller.tick(); assert.equal(f.calls.get, 1);
  gate.resolve(); await work;
  const saved = f.database.get('local-1');
  assert.equal(saved.cutoutLocalUri, 'file:///verified-cutout.png');
  assert.equal(saved.localId, original.localId); assert.equal(saved.originalLocalUri, original.originalLocalUri);
  await new ProcessingPoller(f.dependencies).tick(); assert.equal(f.calls.get, 1);
});

test('broken cutout keeps original and retries with backoff; missing optional thumbnail is harmless', async () => {
  const f = fixture([garment('local-1', { remoteId: 'existing', status: 'processing' })]);
  f.dependencies.cacheRemoteAsset = async () => { throw new Error('corrupt PNG'); };
  await new ProcessingPoller(f.dependencies).tick();
  const saved = f.database.get('local-1');
  assert.equal(saved.cutoutLocalUri, null); assert.ok(saved.originalLocalUri);
  assert.equal(saved.pollAttempts, 1); assert.ok(saved.nextPollAt > 1_000);
  f.setTime(saved.nextPollAt);
  f.api.get = async (id) => remote(id, 'ready', { thumbnail_url: '/thumbnail' });
  f.dependencies.cacheRemoteAsset = async (_id, _url, kind) => {
    if (kind === 'thumbnail') throw new Error('404'); return 'file:///verified.png';
  };
  await new ProcessingPoller(f.dependencies).tick();
  assert.equal(saved.cutoutLocalUri, 'file:///verified.png');
  assert.equal(saved.lastError, null); assert.equal(saved.thumbnailLocalUri, null);
});

test('quality gate needs_review and failed stop polling and retain original', async () => {
  for (const status of ['needs_review', 'failed']) {
    const f = fixture([garment('local-1', { remoteId: 'existing', status: 'processing' })], {
      async get(id) { f.calls.get++; return remote(id, status); },
    });
    const poller = new ProcessingPoller(f.dependencies);
    await poller.tick(); f.setTime(100_000); await poller.tick();
    const saved = f.database.get('local-1');
    assert.equal(saved.status, status); assert.ok(saved.originalLocalUri);
    assert.equal(saved.cutoutLocalUri, null); assert.equal(f.calls.get, 1); assert.equal(f.calls.cache.length, 0);
  }
});

test('deletion during asset download cannot resurrect a garment or leave downloaded assets', async () => {
  const f = fixture([garment('local-1', { remoteId: 'existing', status: 'processing' })]);
  f.dependencies.cacheRemoteAsset = async () => { f.database.delete('local-1'); return 'file:///late.png'; };
  await new ProcessingPoller(f.dependencies).tick();
  assert.equal(f.database.size, 0); assert.deepEqual(f.calls.removed, ['local-1']);
});

test('shared per-item locks exclude processing polling while a retry request is in progress', async () => {
  const gate = deferred(); const entered = deferred();
  const f = fixture([garment('local-1', { remoteId: 'existing', status: 'processing', retryRequested: true })]);
  f.api.retry = async (id) => { entered.resolve(); await gate.promise; return remote(id); };
  const queue = new UploadQueue(f.dependencies); const poller = new ProcessingPoller(f.dependencies);
  const work = queue.drain(); await entered.promise;
  f.database.get('local-1').retryRequested = false;
  assert.equal((await f.repository.getPollCandidates(1000)).length, 1, 'the candidate is excluded by its live lock');
  await poller.tick(); assert.equal(f.calls.get, 0); gate.resolve(); await work;
});

test('coordinator waits for connectivity, aborts background work, and resumes in foreground', async () => {
  let uploads = 0; let polls = 0; let aborted = 0;
  const queue = {
    drain(signal) { uploads++; return new Promise((resolve) => signal.addEventListener('abort', () => { aborted++; resolve(); })); },
    cancel() {}, cancelAll() {},
  };
  const poller = { async tick() { polls++; }, cancel() {}, cancelAll() {} };
  const engine = new SyncEngine(queue, poller);
  engine.setForeground(true); engine.wake(); await settle(); assert.equal(uploads, 0);
  engine.setConnected(true); await settle(); assert.equal(uploads, 1); assert.equal(polls, 1);
  engine.wake(); await settle(); assert.equal(uploads, 1);
  engine.setForeground(false); await settle(); assert.equal(aborted, 1);
  engine.setForeground(true); await settle(); assert.equal(uploads, 2);
  engine.stop(); await settle(); assert.equal(aborted, 2);
});

test('poll heartbeat continues while one slow upload remains in flight', async () => {
  const uploadGate = deferred(); let uploads = 0; let polls = 0; let heartbeat;
  const queue = { async drain() { uploads++; await uploadGate.promise; }, cancel() {}, cancelAll() {} };
  const poller = { async tick() { polls++; }, cancel() {}, cancelAll() {} };
  const engine = new SyncEngine(queue, poller, {
    start(callback) { heartbeat = callback; return 1; }, stop() {},
  });
  engine.setForeground(true); engine.setConnected(true); await settle();
  assert.equal(uploads, 1); assert.equal(polls, 1);
  heartbeat(); await settle(); heartbeat(); await settle();
  assert.equal(polls, 3, 'ready previews keep polling while multipart transfer is pending');
  assert.equal(uploads, 1, 'heartbeat cannot start overlapping uploads');
  engine.stop(); uploadGate.resolve(); await settle();
});

function runtimeMocks(baseUrl = 'http://ai.local:8000', network = {}) {
  const state = { appListener: null, networkListener: null, stopped: 0, removed: 0, changes: [] };
  const f = fixture([garment('local-1', {
    remoteId: 'existing', status: 'failed', uploadAttempts: 5, pollAttempts: 9,
    nextAttemptAt: 9_999, nextPollAt: 9_999, lastError: 'Old error',
  }), garment('local-2', { status: 'failed', uploadAttempts: 5 })]);
  f.repository.recoverInterrupted = async () => {};
  f.repository.subscribe = () => () => { state.removed++; };
  class FakeEngine {
    setForeground(value) { state.changes.push(['foreground', value]); }
    setConnected(value) { state.changes.push(['connected', value]); }
    cancel(id) { state.changes.push(['cancel', id]); }
    wake() { state.changes.push(['wake']); }
    stop() { state.stopped++; }
  }
  const mocks = {
    'react-native': { AppState: { currentState: 'active', addEventListener(_name, listener) {
      state.appListener = listener; return { remove() { state.removed++; } };
    } } },
    'expo-network': {
      async getNetworkStateAsync() { return { isConnected: true, isInternetReachable: false }; },
      addNetworkStateListener(listener) { state.networkListener = listener; return { remove() { state.removed++; } }; },
      ...network,
    },
    '../../config/env': { API_BASE_URL: baseUrl, configurationError: baseUrl ? null : 'Missing URL' },
    '../storage/database': { repository: f.repository },
    '../storage/files': { cacheRemoteAsset() {}, removeGarmentFiles() {} },
    '../storage/uploadImage': { prepareUploadImage: async (garment) => garment },
    '../api/garments': { GarmentsApi: class {} },
    './syncEngine': { SyncEngine: FakeEngine },
  };
  return { state, f, runtime: loadTs('src/services/queue/synchronization.ts', mocks) };
}

test('manual retry resets bounded attempts and queues remote retry without losing its server ID', async () => {
  const { f, runtime } = runtimeMocks();
  await runtime.retryGarment('local-1');
  const remoteRow = f.database.get('local-1');
  assert.equal(remoteRow.remoteId, 'existing'); assert.equal(remoteRow.retryRequested, true);
  assert.equal(remoteRow.uploadAttempts, 0); assert.equal(remoteRow.pollAttempts, 0);
  assert.equal(remoteRow.nextAttemptAt, 0); assert.equal(remoteRow.lastError, null);
  await runtime.retryGarment('local-2');
  const local = f.database.get('local-2');
  assert.equal(local.status, 'upload_queued'); assert.equal(local.retryRequested, false);
  await runtime.retryGarment('deleted-id'); assert.equal(f.database.size, 2);
});

test('retrying a ready preview schedules only GET/download instead of another GPU job', async () => {
  const { f, runtime } = runtimeMocks();
  const row = f.database.get('local-1');
  Object.assign(row, { status: 'ready', cutoutLocalUri: 'file:///missing.png', thumbnailLocalUri: 'file:///missing.webp' });
  await runtime.retryGarment('local-1');
  assert.equal(row.status, 'ready'); assert.equal(row.remoteId, 'existing');
  assert.equal(row.cutoutLocalUri, null); assert.equal(row.thumbnailLocalUri, null);
  assert.equal(row.retryRequested, false); assert.equal(row.nextPollAt, 0);
  assert.equal((await f.repository.getUploadCandidates(1_000)).length, 0);
  assert.equal((await f.repository.getPollCandidates(1_000)).length, 1);
});

test('native adapter shares one runtime, supports LAN without public Internet, and disposes subscriptions', async () => {
  const { state, runtime } = runtimeMocks();
  const stopFirst = runtime.startSynchronization(); const stopSecond = runtime.startSynchronization();
  await settle();
  assert.ok(state.changes.some(([kind, value]) => kind === 'foreground' && value === true));
  assert.ok(state.changes.some(([kind, value]) => kind === 'connected' && value === true));
  state.appListener('background');
  assert.deepEqual(state.changes.at(-1), ['foreground', false]);
  state.networkListener({ isConnected: false, isInternetReachable: false });
  assert.deepEqual(state.changes.at(-1), ['connected', false]);
  stopFirst(); assert.equal(state.stopped, 0);
  stopSecond(); assert.equal(state.stopped, 1); assert.equal(state.removed, 3);
  stopSecond(); assert.equal(state.stopped, 1);
});

test('native adapter with missing API configuration starts no subscriptions or network jobs', () => {
  const { state, runtime } = runtimeMocks('');
  runtime.startSynchronization()();
  assert.equal(state.appListener, null); assert.equal(state.networkListener, null);
  assert.deepEqual(state.changes, []);
});

for (const connected of [true, false]) {
  test(`a delayed network query cannot overwrite a newer native event (${connected})`, async () => {
    const query = deferred();
    const { state, runtime } = runtimeMocks('http://ai.local:8000', {
      getNetworkStateAsync: () => query.promise,
    });
    const stop = runtime.startSynchronization();
    try {
      await settle();
      state.networkListener({ isConnected: connected });
      query.resolve({ isConnected: !connected });
      await settle();
      assert.deepEqual(state.changes.filter(([kind]) => kind === 'connected'), [['connected', connected]]);
    } finally { stop(); }
  });
}

test('a failed old network query cannot pause a newer Wi-Fi connection', async () => {
  const query = deferred();
  const { state, runtime } = runtimeMocks('http://ai.local:8000', {
    getNetworkStateAsync: () => query.promise,
  });
  const stop = runtime.startSynchronization();
  try {
    await settle();
    state.networkListener({ isConnected: true });
    query.reject(new Error('old native network query failed'));
    await settle();
    assert.deepEqual(state.changes.filter(([kind]) => kind === 'connected'), [['connected', true]]);
  } finally { stop(); }
});

test('overlapping network queries apply only the latest foreground result', async () => {
  const oldQuery = deferred(); const newQuery = deferred(); let calls = 0;
  const { state, runtime } = runtimeMocks('http://ai.local:8000', {
    getNetworkStateAsync: () => ++calls === 1 ? oldQuery.promise : newQuery.promise,
  });
  const stop = runtime.startSynchronization();
  try {
    await settle();
    state.appListener('background'); state.appListener('active');
    newQuery.resolve({ isConnected: true });
    await settle();
    oldQuery.resolve({ isConnected: false });
    await settle();
    assert.deepEqual(state.changes.filter(([kind]) => kind === 'connected'), [['connected', true]]);
  } finally { stop(); }
});
