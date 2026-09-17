import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createLagProxy } from '../netcode/lag-proxy.mjs';

test('latency proxy preserves ordered leave/cancel messages before graceful close', { timeout: 8000 }, async () => {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  const received = [];
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  upstream.on('connection', socket => {
    socket.on('message', (data, binary) => received.push({ text: data.toString(), binary }));
    socket.on('close', resolveClosed);
  });
  const proxy = await createLagProxy(`http://127.0.0.1:${upstream.address().port}`, { rtt: 80, jitter: 20 });
  try {
    const client = new WebSocket(proxy.url.replace('http:', 'ws:') + '/play', { origin: 'http://127.0.0.1:4173' });
    await once(client, 'open');
    client.send('first'); client.send(Buffer.from('binary'), { binary: true }); client.send('{"type":"leave"}');
    client.close(1000, 'leaving_online');
    await closed;
    assert.deepEqual(received, [
      { text: 'first', binary: false }, { text: 'binary', binary: true }, { text: '{"type":"leave"}', binary: false },
    ]);
  } finally { await proxy.close(); await new Promise(resolve => upstream.close(resolve)); }
});
