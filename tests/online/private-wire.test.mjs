import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../../server/index.mjs';
import { configuration } from '../../server/config.mjs';
import { PROTOCOL, PHYSICS_SHA256, decodeSnapshot } from '../../src/online/protocol.js';
const origin = 'http://127.0.0.1:4173';
const delay = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeout = 5000) { const start = performance.now(); while (!fn()) { if (performance.now() - start > timeout) throw Error('Condition timed out'); await delay(10); } return fn(); }
async function client(app, name) {
  const response = await fetch(`http://127.0.0.1:${app.port}/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  assert.equal(response.status, 200); const session = await response.json();
  return connect(app, session);
}
async function connect(app, session) {
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/play`, { origin });
  const messages = [], snapshots = [];
  ws.on('message', (data, binary) => { if (binary) snapshots.push(decodeSnapshot(data)); else messages.push(JSON.parse(data)); });
  await once(ws, 'open');
  const send = message => ws.send(JSON.stringify(message));
  send({ type: 'hello', protocol: PROTOCOL, physics: PHYSICS_SHA256, token: session.token });
  await waitFor(() => messages.find(m => ['connected', 'reserved', 'private_room', 'error'].includes(m.type)));
  return { ws, messages, snapshots, session, send, async close() { if (ws.readyState !== WebSocket.CLOSED) { ws.terminate(); await once(ws, 'close'); } } };
}

for (const size of [1, 2, 3]) test(`private ${size}v${size}: real sockets, lobby refresh, ready check, authoritative match and unrated result`, { timeout: 20000 }, async () => {
  const app = await createGameServer(configuration({ PORT: '0', MAX_ROOMS: '1' })), clients = [];
  try {
    for (let i = 0; i < size * 2; i++) clients.push(await client(app, `Private Player ${i}`));
    const host = clients[0];
    host.send({ type: 'private_create', size, request: 1, visual: 'fennec' });
    const lobby = await waitFor(() => host.messages.find(m => m.type === 'private_room'));
    for (const c of clients.slice(1)) c.send({ type: 'private_join', code: lobby.code, request: 1, visual: 'fennec' });
    await waitFor(() => host.messages.findLast(m => m.type === 'private_room')?.canStart);
    assert.equal(app.lobby.rooms.size, 0);
    await host.close();
    const replacement = await connect(app, host.session); clients[0] = replacement;
    assert.equal(replacement.messages.find(m => m.type === 'private_room').code, lobby.code);
    clients[1].send({ type: 'private_start', winner: 1, mmr: 99999 });
    await waitFor(() => clients[1].messages.some(m => m.code === 'private_host_required'));
    replacement.send({ type: 'private_start' });
    await waitFor(() => clients.every(c => c.messages.some(m => m.type === 'reserved')));
    const reservations = clients.map(c => c.messages.find(m => m.type === 'reserved'));
    assert(reservations.every(m => m.private && m.mode === 'casual' && m.size === size));
    assert.equal(new Set(reservations.map(m => m.matchId)).size, 1);
    assert.equal(new Set(reservations.map(m => m.self)).size, size * 2);
    const room = app.lobby.rooms.get(reservations[0].matchId);
    assert(!room.active);
    clients.slice(1).forEach(c => c.send({ type: 'ready', matchId: room.id }));
    await delay(50); assert(!room.active, 'host must finish loading too');
    replacement.send({ type: 'ready', matchId: room.id });
    await waitFor(() => room.active); room.match.phaseTicks = 1;
    await waitFor(() => room.match.state.phase === 'playing');
    replacement.send({ type: 'input', matchId: room.id, epoch: room.epoch, seq: 1, controls: [1, 0, 0, 0, 0, 0, 1, 0] });
    await waitFor(() => clients.every(c => c.snapshots.some(s => s.acknowledgements.includes(1))));
    for (const c of clients) if (room.players.find(p => p.id === c.session.player.id).team === 0) c.send({ type: 'forfeit', matchId: room.id });
    await waitFor(() => clients.every(c => c.messages.some(m => m.type === 'result')));
    for (const c of clients) {
      const result = c.messages.find(m => m.type === 'result'); assert.equal(result.winner, 1); assert.deepEqual(result.changes, []);
      assert.equal(app.sessions.get(c.session.token).casual.size, 0, 'private result must not update hidden Casual skill');
    }
  } finally { for (const c of clients) await c.close(); await app.close(); }
});
