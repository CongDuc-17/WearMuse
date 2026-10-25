const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTs } = require('./helpers/load-ts.cjs');
const { garmentGroup, summarizeWardrobe, filterWardrobe } = loadTs('src/features/wardrobe/presentation.ts');

const item = (status, cutoutLocalUri = null) => ({ status, cutoutLocalUri });

test('ready items appear in the completed filter only after the cutout is stored locally', () => {
  assert.equal(garmentGroup(item('ready')), 'processing');
  assert.equal(garmentGroup(item('ready', 'file:///cutout.png')), 'ready');
  for (const status of ['local_saved', 'upload_queued', 'uploading', 'queued', 'processing']) {
    assert.equal(garmentGroup(item(status)), 'processing');
  }
  for (const status of ['failed', 'needs_review']) assert.equal(garmentGroup(item(status)), 'attention');
});

test('filters retain capture order and partition every item exactly once', () => {
  const garments = [item('failed'), item('ready', 'file:///one.png'), item('ready'), item('processing'), item('needs_review')];
  assert.equal(filterWardrobe(garments, 'all'), garments);
  assert.deepEqual(filterWardrobe(garments, 'attention'), [garments[0], garments[4]]);
  assert.deepEqual(filterWardrobe(garments, 'processing'), [garments[2], garments[3]]);
  const summary = summarizeWardrobe(garments);
  assert.deepEqual(summary, { all: 5, ready: 1, processing: 2, attention: 2 });
  assert.equal(summary.all, summary.ready + summary.processing + summary.attention);
  assert.deepEqual(summarizeWardrobe([]), { all: 0, ready: 0, processing: 0, attention: 0 });
});

test('a completed result automatically moves from processing to ready without changing the item ID', () => {
  const garment = { ...item('ready'), localId: 'stable-id' };
  assert.equal(filterWardrobe([garment], 'ready').length, 0);
  garment.cutoutLocalUri = 'file:///verified.png';
  assert.equal(filterWardrobe([garment], 'ready')[0].localId, 'stable-id');
  assert.equal(filterWardrobe([garment], 'processing').length, 0);
});
