import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForReady } from '../../src/online/readiness.js';
function fixture(responses) {
  let time = 0, calls = 0; const progress = [];
  return { options: { now: () => time, delay: async ms => { time += ms; }, onProgress: p => progress.push(p), fetchImpl: async () => {
    const response = responses[Math.min(calls++, responses.length - 1)]; if (response instanceof Error) throw response; return response.clone();
  } }, calls: () => calls, time: () => time, progress };
}
test('readiness returns a ready server without polling in the background', async () => {
  const f = fixture([Response.json({ ready: true, ranked: false })]);
  assert.deepEqual(await waitForReady('http://127.0.0.1:8080', f.options), { ready: true, ranked: false });
  assert.equal(f.calls(), 1); assert.equal(f.time(), 0);
});
test('cold-start HTML, network failures and warming JSON retry then succeed', async () => {
  const f = fixture([new Response('<html>Waking</html>', { status: 503 }), new TypeError('offline'), Response.json({ ready: false }, { status: 503 }), Response.json({ ready: true })]);
  assert((await waitForReady('https://game.example', f.options)).ready); assert.equal(f.calls(), 4); assert.equal(f.progress.length, 3);
});
test('readiness has a hard deadline and rejects non-retryable deployment errors', async () => {
  const warming = fixture([Response.json({ ready: false }, { status: 503 })]);
  await assert.rejects(waitForReady('https://game.example', { ...warming.options, timeoutMs: 1000 }), /did not become ready/);
  assert.equal(warming.time(), 1000); assert(warming.calls() <= 3);
  const forbidden = fixture([Response.json({}, { status: 403 })]);
  await assert.rejects(waitForReady('https://game.example', forbidden.options), /403/); assert.equal(forbidden.calls(), 1);
});
test('cancel stops readiness immediately and does not create a session or queue', async () => {
  const controller = new AbortController(); controller.abort(); const f = fixture([Response.json({ ready: true })]);
  await assert.rejects(waitForReady('https://game.example', { ...f.options, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.calls(), 0);
});
