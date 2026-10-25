const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { loadTs } = require('./helpers/load-ts.cjs');
const { AbortController: ReactNativeAbortController } = require('abort-controller/dist/abort-controller');
require('./load-typescript.cjs');
const { UploadQueue } = require('../src/services/queue/uploadQueue.ts');
const { ProcessingPoller } = require('../src/services/queue/processingPoller.ts');

function databaseAdapter(filename = ':memory:') {
  const database = new DatabaseSync(filename);
  const parameters = (values) => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  return {
    database,
    async execAsync(sql) { database.exec(sql); },
    async runAsync(sql, ...values) { return database.prepare(sql).run(...parameters(values)); },
    async getFirstAsync(sql, ...values) { return database.prepare(sql).get(...parameters(values)) ?? null; },
    async getAllAsync(sql, ...values) { return database.prepare(sql).all(...parameters(values)); },
    async closeAsync() { database.close(); },
  };
}

function makeRepository(adapter = databaseAdapter()) {
  const { createGarmentRepository } = loadTs('src/services/storage/database.ts', {
    'expo-sqlite': { openDatabaseAsync: async () => adapter },
  });
  return { adapter, repository: createGarmentRepository(async () => adapter) };
}

function garment(id, patch = {}) {
  return {
    localId: id, remoteId: null, originalLocalUri: `file:///documents/${id}/original.jpg`,
    cutoutLocalUri: null, thumbnailLocalUri: null, originalRemoteUrl: null,
    cutoutRemoteUrl: null, thumbnailRemoteUrl: null, mimeType: 'image/jpeg', fileName: 'original.jpg',
    status: 'upload_queued', uploadAttempts: 0, nextAttemptAt: 0,
    pollAttempts: 0, nextPollAt: 0, retryRequested: false, lastError: null,
    createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', ...patch,
  };
}

test('SQLite preserves pending uploads, remote IDs and interrupted jobs across restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wearmuse-storage-'));
  const filename = path.join(directory, 'test.db');
  const first = makeRepository(databaseAdapter(filename));
  try {
    await first.repository.insert(garment('pending', { status: 'uploading' }));
    await first.repository.insert(garment('remote', { remoteId: 'server-1', status: 'processing' }));
    await first.repository.insert(garment('accepted', { remoteId: 'server-2', status: 'uploading' }));
    await first.adapter.closeAsync();
    const reopened = makeRepository(databaseAdapter(filename));
    try {
      await reopened.repository.recoverInterrupted();
      assert.equal((await reopened.repository.get('pending')).status, 'upload_queued');
      assert.equal((await reopened.repository.get('accepted')).status, 'queued');
      assert.equal((await reopened.repository.get('accepted')).remoteId, 'server-2');
      assert.deepEqual((await reopened.repository.getUploadCandidates(Date.now())).map((g) => g.localId), ['pending']);
      assert.equal((await reopened.repository.getPollCandidates(Date.now())).length, 2);
    } finally { await reopened.adapter.closeAsync(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('updating a preview preserves capture ordering and suppresses no-op notifications', async () => {
  const { repository, adapter } = makeRepository();
  try {
    await repository.insert(garment('first'));
    await repository.insert(garment('second', { createdAt: '2026-10-15T10:01:00.000Z' }));
    const events = [];
    repository.subscribe((id) => events.push(id));
    assert.equal(await repository.update('first', { status: 'ready', cutoutLocalUri: 'file:///cutout.png' }), true);
    assert.equal(await repository.update('first', { status: 'ready', cutoutLocalUri: 'file:///cutout.png', updatedAt: 'ignored' }), true);
    assert.deepEqual(events, ['first']);
    assert.deepEqual((await repository.list()).map((g) => g.localId), ['second', 'first']);
    await repository.update('first', { localId: 'changed', createdAt: '2099-01-01' });
    assert.equal((await repository.get('first')).createdAt, '2026-10-15T10:00:00.000Z');
  } finally { await adapter.closeAsync(); }
});

test('queue candidates honor due times and terminal states without re-uploading remote IDs', async () => {
  const { repository, adapter } = makeRepository();
  try {
    for (const record of [
      garment('due'), garment('delayed', { nextAttemptAt: 200 }),
      garment('invalid', { status: 'failed' }),
      garment('retry', { remoteId: 'remote-retry', status: 'failed', retryRequested: true }),
      garment('processing', { remoteId: 'remote-process', status: 'processing' }),
      garment('review', { remoteId: 'remote-review', status: 'needs_review' }),
      garment('ready', { remoteId: 'remote-ready', status: 'ready', cutoutLocalUri: 'file:///cutout.png' }),
      garment('missing-asset', { remoteId: 'remote-asset', status: 'ready' }),
    ]) await repository.insert(record);
    assert.deepEqual((await repository.getUploadCandidates(100)).map((g) => g.localId), ['due', 'retry']);
    assert.deepEqual((await repository.getPollCandidates(100)).map((g) => g.localId), ['missing-asset', 'processing']);
  } finally { await adapter.closeAsync(); }
});

test('upload retries without restarting after a temporary SQLite write outage', async () => {
  const adapter = databaseAdapter();
  const { repository } = makeRepository(adapter);
  const run = adapter.runAsync;
  let blocked = false; let uploads = 0;
  adapter.runAsync = async (...args) => {
    if (blocked) throw new Error('temporary SQLite write outage');
    return run(...args);
  };
  try {
    const original = garment('interrupted-write');
    await repository.insert(original);
    const api = {
      async upload() {
        uploads++;
        if (uploads === 1) { blocked = true; throw new Error('connection interrupted'); }
        return { id: 'accepted', status: 'queued', original_url: null, cutout_url: null, thumbnail_url: null };
      },
      resolveUrl: (url) => url,
    };
    const queue = new UploadQueue({ repository, api, now: () => 1000 });
    await assert.rejects(queue.drain(), /SQLite write outage/);
    assert.equal((await repository.get(original.localId)).status, 'uploading');
    blocked = false;
    await queue.drain();
    const saved = await repository.get(original.localId);
    assert.equal(uploads, 2, 'the next heartbeat can retry without restarting the app');
    assert.equal(saved.remoteId, 'accepted');
    assert.equal(saved.status, 'queued');
    assert.equal(saved.originalLocalUri, original.originalLocalUri);
  } finally { await adapter.closeAsync(); }
});

test('an accepted upload with interrupted SQLite metadata resumes through GET, without another POST', async () => {
  const adapter = databaseAdapter();
  const { repository } = makeRepository(adapter);
  const run = adapter.runAsync;
  let blocked = false; let failOnce = true; let uploads = 0; let polls = 0;
  adapter.runAsync = async (sql, ...values) => {
    if (failOnce && sql.includes('originalRemoteUrl = ?')) { blocked = true; failOnce = false; }
    if (blocked) throw new Error('temporary SQLite metadata outage');
    return run(sql, ...values);
  };
  try {
    const original = garment('accepted-write');
    await repository.insert(original);
    const api = {
      async upload() {
        uploads++;
        return { id: 'accepted', status: 'queued', original_url: '/original', cutout_url: null, thumbnail_url: null };
      },
      async get(id) {
        polls++;
        assert.equal(id, 'accepted');
        return { id, status: 'ready', original_url: '/original', cutout_url: '/cutout', thumbnail_url: null };
      },
      resolveUrl: (url) => `http://ai.local:8000${url}`,
    };
    const locks = new Set();
    const queue = new UploadQueue({ repository, api, locks, now: () => 1000 });
    await assert.rejects(queue.drain(), /SQLite metadata outage/);
    const interrupted = await repository.get(original.localId);
    assert.equal(interrupted.remoteId, 'accepted');
    assert.equal(interrupted.status, 'uploading');
    blocked = false;
    await queue.drain();
    await new ProcessingPoller({
      repository, api, locks, now: () => 1000,
      cacheRemoteAsset: async () => 'file:///verified-cutout.png',
      removeGarmentFiles: async () => assert.fail('the original garment still exists'),
    }).tick();
    const saved = await repository.get(original.localId);
    assert.equal(uploads, 1);
    assert.equal(polls, 1, 'the accepted remote ID stays eligible for status recovery');
    assert.equal(saved.status, 'ready');
    assert.equal(saved.cutoutLocalUri, 'file:///verified-cutout.png');
    assert.equal(saved.originalLocalUri, original.originalLocalUri);
  } finally { await adapter.closeAsync(); }
});

test('a live accepted upload keeps its lock while SQLite metadata is being committed', async () => {
  const { repository, adapter } = makeRepository();
  const entered = Promise.withResolvers(); const release = Promise.withResolvers();
  const update = repository.update;
  let work; let polls = 0; let uploads = 0;
  try {
    await repository.insert(garment('live-upload'));
    repository.update = async (id, patch) => {
      const result = await update(id, patch);
      if (patch.remoteId && Object.keys(patch).length === 1) {
        entered.resolve();
        await release.promise;
      }
      return result;
    };
    const api = {
      async upload() { uploads++; return { id: 'accepted', status: 'queued', original_url: null, cutout_url: null, thumbnail_url: null }; },
      async get() { polls++; assert.fail('a live upload must finish committing before status polling'); },
      resolveUrl: (url) => url,
    };
    const dependencies = { repository, api, locks: new Set(), now: () => 1000 };
    const queue = new UploadQueue(dependencies);
    work = queue.drain();
    await entered.promise;
    assert.equal((await repository.getPollCandidates(1000)).length, 1);
    await new ProcessingPoller({ ...dependencies, cacheRemoteAsset: async () => '', removeGarmentFiles: async () => {} }).tick();
    await queue.drain();
    assert.equal(polls, 0);
    assert.equal(uploads, 1);
  } finally { release.resolve(); await work; await adapter.closeAsync(); }
});

test('serialized deletion rejects late responses and does not recreate jobs', async () => {
  const { repository, adapter } = makeRepository();
  try {
    await repository.insert(garment('deleted'));
    await Promise.all([repository.remove('deleted'), repository.update('deleted', { remoteId: 'late', status: 'ready' })]);
    assert.equal(await repository.get('deleted'), null);
    assert.equal(await repository.update('deleted', { status: 'processing' }), false);
    assert.deepEqual(await repository.getUploadCandidates(Date.now()), []);
  } finally { await adapter.closeAsync(); }
});

function photoSaver(dependencies) {
  return loadTs('src/services/camera/capture.ts', {
    '../../features/wardrobe/store': { initializeWardrobe: async () => {} },
    '../storage/database': { repository: {} },
    '../storage/files': {},
  }).createPhotoSaver(dependencies);
}

test('capture awaits durable copy before inserting metadata and job, and supports consecutive captures', async () => {
  const events = [];
  let resolveCopy;
  let sequence = 0;
  const saver = photoSaver({
    initialize: async () => {}, createId: () => `photo-${sequence++}`,
    persist: async (id) => {
      events.push(`copy:${id}`);
      if (id === 'photo-0') await new Promise((resolve) => { resolveCopy = resolve; });
      return { uri: `file:///documents/${id}.jpg`, mimeType: 'image/jpeg', fileName: 'original.jpg' };
    },
    insert: async (record) => { events.push(`insert:${record.localId}`); assert.equal(record.status, 'upload_queued'); },
    cleanup: async () => assert.fail('successful capture must retain its original'),
  });
  const first = saver('file:///camera/first.jpg');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['copy:photo-0']);
  resolveCopy();
  const saved = await first;
  const second = await saver('file:///camera/second.jpg');
  assert.notEqual(saved.localId, second.localId);
  assert.deepEqual(events, ['copy:photo-0', 'insert:photo-0', 'copy:photo-1', 'insert:photo-1']);
});

test('copy failure never inserts a saved record, database failure cleans the orphan', async () => {
  for (const failure of ['copy', 'database']) {
    const events = [];
    const saver = photoSaver({
      initialize: async () => {}, createId: () => 'failed-photo',
      persist: async () => {
        if (failure === 'copy') throw new Error('disk full');
        return { uri: 'file:///documents/photo.jpg', mimeType: 'image/jpeg', fileName: 'original.jpg' };
      },
      insert: async () => { events.push('insert'); throw new Error('database full'); },
      cleanup: async (id) => events.push(`cleanup:${id}`),
    });
    await assert.rejects(saver('file:///camera/photo.jpg'), /full/);
    assert.deepEqual(events, failure === 'copy' ? ['cleanup:failed-photo'] : ['insert', 'cleanup:failed-photo']);
  }
});

test('delete commits removal before cleaning only its local ID', async () => {
  const events = [];
  const { deleteGarment } = loadTs('src/features/wardrobe/actions.ts', {
    '../../services/storage/database': { repository: { remove: async (id) => events.push(`delete:${id}`) } },
    '../../services/storage/files': { removeGarmentFiles: async (id) => events.push(`cleanup:${id}`) },
  });
  await deleteGarment('safe-local-id');
  assert.deepEqual(events, ['delete:safe-local-id', 'cleanup:safe-local-id']);
});

function fileHarness(options = {}) {
  const files = new Map([['file:///camera/photo.png', 1234]]);
  const directories = new Set(['file:///documents']);
  const events = [];
  const join = (parts) => parts.map((part) => typeof part === 'string' ? part : part.uri)
    .map((part, index) => index ? part.replace(/^\/+|\/+$/g, '') : part.replace(/\/+$/g, '')).join('/');
  class Directory {
    constructor(...parts) { this.uri = join(parts); }
    get exists() { return directories.has(this.uri); }
    get name() { return this.uri.split('/').at(-1); }
    create() { directories.add(this.uri); directories.add(this.uri.slice(0, this.uri.lastIndexOf('/'))); }
    delete() {
      events.push(`delete-directory:${this.uri}`);
      for (const uri of files.keys()) if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
      for (const uri of directories) if (uri === this.uri || uri.startsWith(`${this.uri}/`)) directories.delete(uri);
    }
    list() {
      return [...directories].filter((uri) => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/'))
        .map((uri) => new Directory(uri));
    }
  }
  class File {
    constructor(...parts) { this.uri = join(parts); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri) ?? 0; }
    async copy(destination) {
      events.push('copy-start');
      await Promise.resolve();
      if (!files.has(this.uri)) throw new Error('source missing');
      files.set(destination.uri, files.get(this.uri));
      events.push('copy-complete');
    }
    async move(destination) {
      events.push(`move:${destination.uri.split('/').at(-1)}`);
      files.set(destination.uri, files.get(this.uri)); files.delete(this.uri); this.uri = destination.uri;
    }
    delete() { files.delete(this.uri); }
    static createDownloadTask(url, destination, taskOptions) {
      return { async downloadAsync() {
        events.push('download');
        files.set(destination.uri, 456);
        if (options.waitForAbort) {
          return new Promise((resolve, reject) => taskOptions.signal.addEventListener('abort', () => {
            const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
          }, { once: true }));
        }
        if (options.abortDownload) { taskOptions.signal.throwIfAborted(); throw new Error('network unavailable'); }
        return destination;
      } };
    }
  }
  const api = loadTs('src/services/storage/files.ts', {
    'expo-file-system': { Directory, File, Paths: { document: new Directory('file:///documents') } },
    'expo-image': { Image: { async loadAsync(uri) {
      events.push('decode');
      assert.ok(files.has(uri));
      if (options.badImage) throw new Error('invalid image');
      return { width: 768, height: 1024, release() { events.push('release-image'); } };
    } } },
  });
  return { api, files, directories, events };
}

test('modern filesystem copy persists a complete original and preserves its actual MIME', async () => {
  const { api, files, events } = fileHarness();
  const saved = await api.persistOriginal('local-id', 'file:///camera/photo.png', 'image/png', 'photo.png');
  assert.equal(saved.mimeType, 'image/png');
  assert.equal(saved.fileName, 'original.png');
  assert.equal(files.get(saved.uri), 1234);
  assert.deepEqual(events, ['copy-start', 'copy-complete', 'move:original.png']);
  assert.equal(files.size, 2, 'source and complete durable copy remain');
});

test('remote preview is decoded before promotion; a corrupt download is removed', async () => {
  const valid = fileHarness();
  const uri = await valid.api.cacheRemoteAsset('local-id', 'http://backend/cutout', 'cutout');
  assert.ok(valid.files.has(uri));
  assert.deepEqual(valid.events.slice(0, 3), ['download', 'decode', 'release-image']);
  assert.match(valid.events[3], /^move:cutout-/);
  const invalid = fileHarness({ badImage: true });
  await assert.rejects(invalid.api.cacheRemoteAsset('local-id', 'http://backend/cutout', 'cutout'), /invalid image/);
  assert.equal(invalid.files.size, 1, 'corrupt partial and destination never remain available to UI');
});

test('asset download and cancellation work with React Native AbortController instead of Node browser APIs', async () => {
  const originalController = globalThis.AbortController;
  globalThis.AbortController = ReactNativeAbortController;
  try {
    const valid = fileHarness();
    const controller = new ReactNativeAbortController();
    assert.equal(typeof controller.signal.throwIfAborted, 'undefined');
    const uri = await valid.api.cacheRemoteAsset('native-id', 'http://backend/cutout', 'cutout', controller.signal);
    assert.ok(valid.files.has(uri));
    const cancelled = fileHarness({ waitForAbort: true });
    const pending = cancelled.api.cacheRemoteAsset('native-cancel', 'http://backend/cutout', 'cutout', controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(cancelled.files.size, 1);
    await assert.rejects(cancelled.api.cacheRemoteAsset('pre-aborted', 'http://backend/cutout', 'cutout', controller.signal), { name: 'AbortError' });
  } finally {
    globalThis.AbortController = originalController;
  }
});

test('cleanup refuses traversal and cannot delete camera or another garment files', async () => {
  const { api, files, events } = fileHarness();
  const first = await api.persistOriginal('first', 'file:///camera/photo.png');
  const second = await api.persistOriginal('second', 'file:///camera/photo.png');
  await assert.rejects(api.removeGarmentFiles('../camera'), /không hợp lệ/);
  await api.removeGarmentFiles('first');
  assert.equal(files.has(first.uri), false);
  assert.equal(files.has(second.uri), true);
  assert.equal(files.has('file:///camera/photo.png'), true);
  await assert.rejects(api.cacheRemoteAsset('first', 'http://backend/cutout', 'cutout'), /đã được xóa/);
  assert.deepEqual(events.filter((entry) => entry.startsWith('delete-directory:')), [
    'delete-directory:file:///documents/wearmuse-garments-v1/first',
  ]);
});

test('startup cleanup collects orphan directories while retaining SQLite-owned originals', async () => {
  const { api, files } = fileHarness();
  const orphan = await api.persistOriginal('orphan', 'file:///camera/photo.png');
  const kept = await api.persistOriginal('kept', 'file:///camera/photo.png');
  await api.cleanupOrphanedGarmentFiles([garment('kept')]);
  assert.equal(files.has(orphan.uri), false);
  assert.equal(files.has(kept.uri), true);
});

test('asset timeout is retryable failure while external abort remains lifecycle cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeout = fileHarness({ waitForAbort: true });
  const pendingTimeout = timeout.api.cacheRemoteAsset('timeout-id', 'http://backend/cutout', 'cutout');
  t.mock.timers.tick(45_000);
  await assert.rejects(pendingTimeout, (error) => error.name !== 'AbortError' && error.message.includes('quá lâu'));
  assert.equal(timeout.files.size, 1);
  const cancelled = fileHarness({ waitForAbort: true });
  const controller = new AbortController();
  const pendingAbort = cancelled.api.cacheRemoteAsset('cancel-id', 'http://backend/cutout', 'cutout', controller.signal);
  controller.abort();
  await assert.rejects(pendingAbort, { name: 'AbortError' });
  assert.equal(cancelled.files.size, 1);
});

test('startup safely rebases iOS container paths and restores missing asset downloads', async () => {
  const { api, files } = fileHarness();
  const original = await api.persistOriginal('relocated', 'file:///camera/photo.png');
  const cutout = await api.cacheRemoteAsset('relocated', 'http://backend/cutout', 'cutout');
  const oldContainer = (uri) => uri.replace('file:///documents/', 'file:///old-ios-container/Documents/');
  const patch = await api.reconcileGarmentFiles(garment('relocated', {
    originalLocalUri: oldContainer(original.uri), cutoutLocalUri: oldContainer(cutout),
    remoteId: 'remote-relocated', status: 'ready',
  }));
  assert.equal(patch.originalLocalUri, original.uri);
  assert.equal(patch.cutoutLocalUri, cutout);
  files.delete(cutout);
  assert.deepEqual(await api.reconcileGarmentFiles(garment('relocated', {
    originalLocalUri: original.uri, remoteId: 'remote-relocated', status: 'ready', cutoutLocalUri: cutout,
  })), { cutoutLocalUri: null, nextPollAt: 0, pollAttempts: 0 });
  const missing = await api.reconcileGarmentFiles(garment('lost', {
    originalLocalUri: 'file:///documents/wearmuse-garments-v1/lost/original.jpg',
  }));
  assert.equal(missing.status, 'failed');
  assert.match(missing.lastError, /Không tìm thấy ảnh gốc/);
  assert.equal(files.has(original.uri), true);
});

test('per-item subscriptions update only one card and preserve the grid ID snapshot', async () => {
  const records = new Map([['one', garment('one')], ['two', garment('two')]]);
  let notify;
  const { wardrobeStore, initializeWardrobe } = loadTs('src/features/wardrobe/store.ts', {
    '../../services/storage/database': { repository: {
      initialize: async () => {}, recoverInterrupted: async () => {},
      list: async () => [...records.values()], get: async (id) => records.get(id) ?? null,
      subscribe(listener) { notify = listener; return () => {}; },
    } },
    '../../services/storage/files': { cleanupOrphanedGarmentFiles: async () => {}, reconcileGarmentFiles: async () => ({}) },
  });
  await initializeWardrobe();
  const initialSnapshot = wardrobeStore.getSnapshot();
  const initialCollection = wardrobeStore.getCollection();
  assert.equal(wardrobeStore.getCollection(), initialCollection, 'collection snapshot stays referentially stable between updates');
  let collectionEvents = 0;
  const unsubscribeCollection = wardrobeStore.subscribeCollection(() => collectionEvents++);
  let gridEvents = 0;
  let firstEvents = 0;
  let secondEvents = 0;
  wardrobeStore.subscribe(() => gridEvents++);
  wardrobeStore.subscribeGarment('one', () => firstEvents++);
  wardrobeStore.subscribeGarment('two', () => secondEvents++);
  records.set('one', { ...records.get('one'), status: 'ready', cutoutLocalUri: 'file:///cutout.png' });
  notify('one');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(firstEvents, 1);
  assert.equal(secondEvents, 0);
  assert.equal(gridEvents, 0);
  assert.equal(wardrobeStore.getSnapshot(), initialSnapshot);
  assert.equal(wardrobeStore.getGarment('one').cutoutLocalUri, 'file:///cutout.png');
  assert.equal(collectionEvents, 1, 'filters and profile counts react to the status update');
  assert.notEqual(wardrobeStore.getCollection(), initialCollection);
  assert.equal(wardrobeStore.getCollection().find((item) => item.localId === 'one').status, 'ready');
  const completedCollection = wardrobeStore.getCollection();
  notify('one');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(collectionEvents, 1, 'no-op refreshes do not rerender the collection');
  assert.equal(wardrobeStore.getCollection(), completedCollection);
  unsubscribeCollection();
});
