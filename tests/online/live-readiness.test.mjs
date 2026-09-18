import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLiveReadiness } from '../../tools/live-readiness.mjs';

function fixture(responses) {
  let time = 0, calls = 0;
  const attempts = [];
  return { attempts, calls: () => calls, time: () => time, options: {
    now: () => time, delay: async ms => { time += ms; }, timeoutMs: 1500,
    onAttempt: attempt => attempts.push(attempt),
    fetchImpl: async (url, request) => {
      assert.equal(request.headers.Origin, 'https://malikahed.github.io');
      assert.equal(url, 'https://game.example/readyz'); assert(request.signal);
      const response = responses[Math.min(calls++, responses.length - 1)];
      if (response instanceof Error) throw response;
      return response.clone();
    },
  } };
}
const ready = () => Response.json({ ready: true, protocol: 2, nativeCheckpoint: 1 }, {
  headers: { 'Access-Control-Allow-Origin': 'https://malikahed.github.io' },
});
test('live acceptance retries a timed-out request instead of abandoning a healthy later cold start', async () => {
  const f = fixture([new DOMException('Request timed out', 'TimeoutError'), ready()]);
  const result = await inspectLiveReadiness('https://game.example', 'https://malikahed.github.io', f.options);
  assert(result.health.ready); assert.equal(f.calls(), 2);
  assert.equal(f.attempts[0].error, 'TimeoutError');
  assert.equal(result.response.allowOrigin, 'https://malikahed.github.io');
});
test('live acceptance treats 403 as a deployment error, never bypassing the origin check', async () => {
  const f = fixture([Response.json({ error: 'origin_forbidden' }, { status: 403 })]);
  await assert.rejects(inspectLiveReadiness('https://game.example', 'https://malikahed.github.io', f.options), /403/);
  assert.equal(f.calls(), 1); assert.equal(f.attempts[0].status, 403);
});
test('live acceptance has a hard deadline through repeated transport failures', async () => {
  const f = fixture([new TypeError('Network unavailable')]);
  await assert.rejects(inspectLiveReadiness('https://game.example', 'https://malikahed.github.io', f.options), /did not become ready/);
  assert.equal(f.time(), 1500); assert(f.calls() <= 3);
});
