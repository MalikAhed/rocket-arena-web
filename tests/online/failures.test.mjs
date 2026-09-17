import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../../server/room.mjs';
import { configuration } from '../../server/config.mjs';
import { NEUTRAL } from '../../src/online/protocol.js';
const settled = () => new Promise(resolve => setImmediate(resolve));
function fixture({ size = 1, mode = 'casual', store = null } = {}) {
  const messages = [], applied = [];
  const players = Array.from({ length: 2 * size }, (_, i) => ({ id: `fixture-${i}`, name: `Fixture ${i}`, team: i % 2, isTest: true, session: { casual: new Map() } }));
  const room = new Room({ players, size, mode, store, region: 'test-only', sessions: {}, peerFor: id => ({ send: message => messages.push({ id, ...message }), sendBinary() {} }), onDispose() {}, config: { graceMs: 100, afkWarnMs: 1000, afkMs: 1500 } });
  room.arena = { input: (slot, values = NEUTRAL) => applied.push({ slot, values }), dispose() {}, reset() {} };
  room.sendSnapshot = () => {};
  room.active = true; room.startedAt = 0; room.tick = 1000; room.match.state.phase = 'playing';
  room.slots.forEach(slot => { slot.lastActivity = 0; });
  return { room, messages, applied };
}
test('pre-kickoff departure is no-contest, not abandonment', async () => {
  const { room } = fixture(); room.active = false; room.match.state.phase = 'waiting';
  room.disconnect('fixture-0', 1); await settled();
  assert.equal(room.result.status, 'cancelled'); assert.equal(room.result.reason, 'player_left_before_kickoff');
  assert(room.slots.every(slot => !slot.abandoned));
});
test('disconnect neutralizes inputs; same slot reconnects within grace; expired slot cannot return', async () => {
  const { room, applied } = fixture({ size: 2 });
  room.input('fixture-0', 1, [1, 0, 0, 0, 0, 1, 1, 0], 1);
  room.disconnect('fixture-0', 2); assert.deepEqual(applied.at(-1).values, NEUTRAL);
  room.admit = () => {}; room.reconnect('fixture-0', 50);
  assert.equal(room.slots.length, 4); assert(room.slots[0].connected);
  room.disconnect('fixture-0', 55); room.checkLifecycle(160);
  assert(room.slots[0].abandoned); assert.throws(() => room.reconnect('fixture-0', 170), e => e.code === 'reconnect_expired');
  assert(!room.terminal, 'one missing teammate does not immediately invalidate the remaining players'); room.dispose();
});
test('a whole team abandoning loses; late/duplicate finish cannot reverse a valid outcome', async () => {
  const { room } = fixture(); room.disconnect('fixture-0', 10, true); room.checkLifecycle(11); await settled();
  assert.equal(room.result.winner, 1); assert.equal(room.result.reason, 'team_abandoned');
  room.finish(0, 'late_result'); assert.equal(room.result.winner, 1); room.dispose();
});
test('AFK warning precedes removal and removes control, not a silent replacement bot', async () => {
  const { room, messages } = fixture({ size: 2 });
  room.slots.slice(1).forEach(slot => { slot.lastActivity = 1000; });
  room.checkLifecycle(1100); assert(messages.some(m => m.id === 'fixture-0' && m.type === 'afk_warning')); assert(room.slots[0].connected);
  room.checkLifecycle(1600); assert(room.slots[0].abandoned); assert.equal(room.players.length, 4); room.dispose();
});
test('Ranked forfeits require one minute and all team votes', async () => {
  const store = { finalize: async (id, outcome) => ({ ...outcome, status: 'completed', changes: [] }) };
  const { room } = fixture({ size: 2, mode: 'ranked', store });
  assert.throws(() => room.forfeit('fixture-0', 59999), e => e.code === 'forfeit_too_early');
  room.forfeit('fixture-0', 60000); assert(!room.terminal);
  room.forfeit('fixture-2', 60000); await settled(); assert.equal(room.result.winner, 1); room.dispose();
});
test('database outage leaves result pending; successful retry publishes once without simulating another match', async () => {
  let calls = 0;
  const store = { finalize: async (id, outcome) => { if (++calls < 3) throw Error('in-process outage fixture'); return { ...outcome, status: 'completed', changes: [] }; } };
  const { room, messages } = fixture({ mode: 'ranked', store });
  room.finish(0, 'full_time'); await settled(); assert(!room.result);
  await room.persist(); assert(!room.result); await room.persist(); assert.equal(room.result.winner, 0);
  await room.persist(); assert.equal(calls, 3);
  assert.equal(messages.filter(m => m.id === 'fixture-0' && m.type === 'result').length, 1); room.dispose();
});
test('TLS URL overrides and transaction-mode poolers are rejected', () => {
  assert.throws(() => configuration({ DATABASE_URL: 'postgresql://localhost/db?sslmode=no-verify' }), /TLS/);
  assert.throws(() => configuration({ DATABASE_URL: 'postgresql://localhost:6543/db' }), /SESSION/);
  assert.throws(() => configuration({ DATABASE_URL: 'https://localhost/db' }), /PostgreSQL/);
});
