require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiClient } = require('../src/services/api/client.ts');
const { createConnectionCheck } = require('../src/services/api/connection.ts');

test('connection check makes only a GET health request and returns the configured API address', async () => {
  const calls = [];
  const client = new ApiClient('http://ai.local:8000', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ ok: true, ai_engine: 'separate worker' });
  });
  const check = createConnectionCheck(client.baseUrl, null, client);
  assert.deepEqual(await check(), { baseUrl: 'http://ai.local:8000' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://ai.local:8000/health');
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[0].options.body, undefined);
});

test('connection check reports invalid configuration without making a request', async () => {
  let calls = 0;
  const check = createConnectionCheck('', 'Chưa kết nối dịch vụ AI.', {
    request: async () => { calls++; },
  });
  await assert.rejects(check(), /Chưa kết nối dịch vụ AI/);
  assert.equal(calls, 0);
});

test('connection check rejects unrelated services and gives the actual address on failure', async () => {
  const check = createConnectionCheck('http://wrong.local:8000', null, {
    request: async () => ({ hello: 'world' }),
  });
  await assert.rejects(check(), (error) => error.message.includes('không xác nhận')
    && error.message.includes('http://wrong.local:8000'));
});

test('connection check bounds hanging native network requests with a timeout', async () => {
  const client = new ApiClient('http://ai.local:8000', async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }), 5);
  await assert.rejects(createConnectionCheck(client.baseUrl, null, client)(), /phản hồi quá lâu/);
});
