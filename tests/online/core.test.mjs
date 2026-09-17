import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { performance } from 'node:perf_hooks';
import { createGameServer } from '../../server/index.mjs';
import { configuration } from '../../server/config.mjs';
import { NativeArena } from '../../server/native.mjs';
import { MatchSession } from '../../src/match/session.js';
import { DEFAULT_RATING_CONFIG as config, initialRating, rankOf, rateTeams, validateRatingConfig } from '../../server/rating.mjs';
import { PROTOCOL, PHYSICS_SHA256, NEUTRAL, validControls, validName, decodeSnapshot, encodeSnapshot } from '../../src/online/protocol.js';
import { balancedTeams, Lobby } from '../../server/lobby.mjs';
import { TokenBucket } from '../../server/limits.mjs';
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
  await waitFor(() => messages.find(m => ['connected', 'reserved', 'error'].includes(m.type)));
  return { ws, messages, snapshots, session, send, async close() { if (ws.readyState !== WebSocket.CLOSED) { ws.terminate(); await once(ws, 'close'); } } };
}
function queue(client, size, request = 1, mode = 'casual') { client.send({ type: 'queue', mode, size, visual: 'fennec', request, region: 'local' }); }

test('protocol validates names, finite bounded controls, and payload shape', () => {
  for (const name of ['Malik', 'Player 2', 'لاعب عربي', 'Guest-One']) assert(validName(name));
  for (const name of ['Admin', 'admin123', 'system', '<img>', ' Player', 'a', 'a\u202Eb', 'Ａdmin']) assert(!validName(name), name);
  assert(validControls([...NEUTRAL]));
  for (const values of [[NaN, ...NEUTRAL.slice(1)], [Infinity, ...NEUTRAL.slice(1)], [2, ...NEUTRAL.slice(1)], [...NEUTRAL, 0], [0, 0, 0, 0, 0, 0.2, 0, 0]]) assert(!validControls(values));
  assert.throws(() => decodeSnapshot(new ArrayBuffer(20)));
  const b = new TokenBucket(1, 2, 0); assert(b.take(0)); assert(b.take(0)); assert(!b.take(0)); assert(b.take(1000));
});
test('team Elo: outcome, opponent strength, placements, thresholds, and no performance stats', () => {
  validateRatingConfig(config);
  const equal = [{ id: 'a', team: 0, ...initialRating() }, { id: 'b', team: 1, ...initialRating() }];
  const result = rateTeams(equal, 0);
  assert.equal(result[0].delta, 48); assert.equal(result[1].delta, -48);
  assert.equal(rankOf(result[0].after).id, 'unranked');
  const unequal = rateTeams([{ ...equal[0], mu: 800 }, { ...equal[1], mu: 1200 }], 0);
  assert(unequal[0].delta > result[0].delta);
  assert.equal(rankOf({ ...initialRating(), games: 9 }).id, 'unranked');
  assert.notEqual(rankOf({ ...initialRating(), games: 10 }).id, 'unranked');
  for (let i = 1; i < config.ranks.length; i++) {
    assert.equal(rankOf({ mu: config.ranks[i].threshold, games: 10 }).id, config.ranks[i].id);
    assert.equal(rankOf({ mu: config.ranks[i].threshold - 0.01, games: 10 }).id, config.ranks[i - 1].id);
  }
  assert.equal(rankOf({ mu: 1000, games: 10 }).division, 1);
  assert.equal(rankOf({ mu: 1025, games: 10 }).division, 2);
  const four = Array.from({ length: 4 }, (_, i) => ({ id: `${i}`, team: i % 2, ...initialRating() }));
  const updates = rateTeams(four, 0); assert.equal(updates.reduce((sum, c) => sum + c.delta, 0), 0);
  assert.throws(() => rateTeams(four.map(p => ({ ...p, team: 0 })), 1));
});
test('team balancing respects requested size without inventing participants', () => {
  const entries = [800, 900, 1000, 1100, 1200, 1300].map((mu, id) => ({ id, rating: { mu } }));
  const teams = balancedTeams(entries, 3);
  assert.equal(teams.filter(p => p.team === 0).length, 3); assert.equal(new Set(teams.map(p => p.id)).size, 6);
  assert.equal(Math.abs(teams.filter(p => p.team === 0).reduce((s, p) => s + p.rating.mu, 0) - teams.filter(p => p.team === 1).reduce((s, p) => s + p.rating.mu, 0)), 100);
});
test('existing match rules preserve countdown, score, timer, overtime and single completion', () => {
  const match = new MatchSession(); match.start();
  for (let i = 0; i < 360; i++) match.tick(); assert.equal(match.state.phase, 'playing');
  match.tick({ kickoffTouched: true }); assert.equal(match.remaining, 35999);
  match.remaining = 1; match.tick({ ballOnGround: true }); assert.equal(match.state.overtime, true); assert.equal(match.state.phase, 'kickoff');
  for (let i = 0; i < 360; i++) match.tick();
  match.tick({ goal: 1, kickoffTouched: true }); assert.equal(match.state.blueScore, 1);
  for (let i = 0; i < 360; i++) match.tick({ goal: 1 });
  assert.equal(match.state.phase, 'ended'); assert.equal(match.state.blueScore, 1); assert.equal(match.state.winner, 0);
  match.tick({ goal: 2 }); assert.equal(match.state.orangeScore, 0);
});
test('headless native physics uses unchanged six-car WASM with compact snapshots', async () => {
  for (const size of [2, 4, 6]) {
    const arena = await NativeArena.create(Array.from({ length: size }, (_, i) => ({ team: i % 2, visual: i % 2 ? 'challenger' : 'fennec' })));
    try {
      const match = new MatchSession(); match.start();
      for (let i = 0; i < 120; i++) { arena.input(0, [1, 0, 0, 0, 0, 0, 1, 0]); arena.step(); }
      assert(arena.state.every(Number.isFinite)); assert.equal(arena.state[2], size);
      const binary = encodeSnapshot({ tick: 120, state: arena.state, match: match.state, acknowledgements: Array(size).fill(12) });
      const decoded = decodeSnapshot(binary); assert.equal(decoded.tick, 120); assert.equal(decoded.acknowledgements[0], 12);
      assert.deepEqual([...decoded.state], [...arena.state]);
      assert.equal(binary.byteLength, ({ 2: 888, 4: 1376, 6: 1864 })[size]);
    } finally { arena.dispose(); }
  }
});
for (const size of [1, 2, 3]) test(`${size}v${size}: independent real WebSocket clients share native state, reconnect and finish once`, { timeout: 20000 }, async () => {
  const app = await createGameServer(configuration({ PORT: '0', MAX_ROOMS: '1' })); const clients = [];
  try {
    for (let i = 0; i < size * 2; i++) clients.push(await client(app, `Test Player ${i}`));
    assert.equal(new Set(clients.map(c => c.session.player.id)).size, size * 2);
    clients.forEach(c => queue(c, size));
    await waitFor(() => clients.every(c => c.messages.some(m => m.type === 'reserved')));
    const ids = clients.map(c => c.messages.find(m => m.type === 'reserved').matchId); assert.equal(new Set(ids).size, 1);
    const room = app.lobby.rooms.get(ids[0]); assert.equal(room.players.length, size * 2); assert.equal(room.match.state.phase, 'waiting');
    clients.forEach(c => c.send({ type: 'ready', matchId: room.id })); await waitFor(() => room.active);
    room.match.phaseTicks = 1; // Test fixture skips countdown, not a network command.
    await waitFor(() => room.match.state.phase === 'playing');
    const oldPosition = room.arena.state.slice(22, 25);
    clients[0].send({ type: 'input', matchId: room.id, epoch: room.epoch, seq: 1, controls: [1, 0, 0, 0, 0, 0, 1, 0] });
    await waitFor(() => clients.every(c => c.snapshots.some(s => s.acknowledgements.includes(1))));
    await delay(150); assert.notDeepEqual(room.arena.state.slice(22, 25), oldPosition);
    const commonTick = clients[0].snapshots.findLast(s => clients.every(c => c.snapshots.some(other => other.tick === s.tick))).tick;
    const common = clients.map(c => c.snapshots.find(s => s.tick === commonTick));
    for (const snapshot of common) assert.deepEqual(snapshot.state, common[0].state);
    await clients[0].close(); await waitFor(() => !room.slots.find(s => s.id === clients[0].session.player.id).connected);
    const replacement = await connect(app, clients[0].session); clients.push(replacement);
    assert.equal(room.arena.state[2], size * 2); assert.equal(room.slots.filter(s => s.connected).length, size * 2);
    await delay(300); assert.deepEqual(room.slots.find(s => s.id === replacement.session.player.id).controls, [...NEUTRAL]);
    // The retained last packet is never applied after the 250ms safety deadline.
    const controls = new Float32Array(room.arena.module.HEAPF32.buffer, room.arena.controlsPtr, 8 * size * 2);
    assert(controls.every(value => value === 0));
    room.finish(0, 'test_fixture'); room.finish(1, 'duplicate_fixture');
    await waitFor(() => replacement.messages.some(m => m.type === 'result'));
    assert.equal(room.result.winner, 0); assert.deepEqual(room.result.changes, []);
    assert.equal(replacement.messages.filter(m => m.type === 'result').length, 1);
  } finally { for (const c of clients) await c.close(); await app.close(); }
});
test('queue separation, duplicate prevention, cancellation, guest Ranked rejection and forged actions', { timeout: 15000 }, async () => {
  const app = await createGameServer(configuration({ PORT: '0' })); const clients = [];
  try {
    const a = await client(app, 'Player Alpha'), b = await client(app, 'Player Beta'); clients.push(a, b);
    queue(a, 1); queue(b, 2); await waitFor(() => app.lobby.entries.size === 2); assert.equal(app.lobby.rooms.size, 0);
    queue(a, 1, 2); await waitFor(() => a.messages.some(m => m.code === 'already_queued_or_playing')); assert.equal(app.lobby.entries.size, 2);
    a.send({ type: 'cancel', request: 1 }); b.send({ type: 'cancel', request: 1 }); await waitFor(() => app.lobby.entries.size === 0);
    queue(a, 1, 3, 'ranked'); await waitFor(() => a.messages.some(m => m.code === 'sign_in_required')); assert.equal(app.lobby.entries.size, 0);
    b.send({ type: 'goal', winner: 0, score: 999, mmr: 99999 }); await waitFor(() => b.messages.some(m => m.code === 'invalid_message'));
    assert.equal(app.lobby.rooms.size, 0);
  } finally { for (const c of clients) await c.close(); await app.close(); }
});
test('asynchronous eligibility cannot resurrect a cancelled search', async () => {
  let resolveRating; const promise = new Promise(resolve => { resolveRating = resolve; });
  const session = { id: 'u:a', accountId: 'a', name: 'Player A', casual: new Map() };
  const lobby = new Lobby({ sessions: { public: () => ({}), configured: true }, store: { ratingFor: () => promise } });
  lobby.peers.set(session.id, { send() {} });
  const pending = lobby.join(session, { mode: 'casual', size: 1, visual: 'fennec', request: 1, region: 'local' });
  lobby.cancel(session, 1); resolveRating(initialRating()); await pending;
  assert.equal(lobby.entries.size, 0); assert.equal(lobby.rooms.size, 0);
});
test('production rejects insecure origins and test auth environment shortcuts', () => {
  assert.throws(() => configuration({ NODE_ENV: 'production', ALLOWED_ORIGINS: origin }));
  assert.throws(() => configuration({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://example.com', DEV_AUTH: '1' }));
  assert.throws(() => configuration({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://example.com', DATABASE_URL: 'postgres://example' }));
});
