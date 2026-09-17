import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Lobby } from '../../server/lobby.mjs';
import { normalizeInviteCode } from '../../server/private-rooms.mjs';

function fixture(config = {}) {
  class FakeRoom {
    constructor(options) { Object.assign(this, options); this.id = randomUUID(); this.private = !!options.privateRoom; }
    async prepare() { this.prepared = true; }
    checkLifecycle() {} step() {}
    cancel(reason) { this.terminal = true; this.reason = reason; }
  }
  const sessions = { public: s => ({ id: s.id, name: s.name }), configured: false, requireRanked: async () => { throw Error('No test auth'); } };
  const lobby = new Lobby({ sessions, RoomClass: FakeRoom, ...config });
  function player() {
    const session = { id: randomUUID(), name: 'Private Guest', casual: new Map(), active: false };
    const peer = { messages: [], send(m) { this.messages.push(m); }, close(code) { this.closed = code; } };
    lobby.attach(session, peer); return { session, peer };
  }
  const create = (p, size = 1) => lobby.privateRooms.create(p.session, { request: 1, size, visual: 'fennec' });
  const join = (p, code) => lobby.privateRooms.join(p.session, { request: 1, code, visual: 'fennec' });
  return { lobby, player, create, join };
}
for (const size of [1, 2, 3]) test(`private ${size}v${size}: guest identities, isolated membership and one host-only start`, async () => {
  const { lobby, player, create, join } = fixture(), people = Array.from({ length: size * 2 }, player);
  const group = create(people[0], size);
  assert.equal(lobby.rooms.size, 0, 'waiting room allocates no physics arena');
  assert.match(group.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.throws(() => lobby.privateRooms.start(people[0].session), e => e.code === 'private_players_not_ready');
  for (const p of people.slice(1)) join(p, ` ${group.code.toLowerCase()} `);
  assert.equal(people[0].peer.messages.at(-1).canStart, true);
  lobby.matchmake(); assert.equal(lobby.rooms.size, 0, 'private members cannot enter public matchmaking');
  await assert.rejects(lobby.join(people[0].session, { mode: 'casual', size, request: 2, visual: 'fennec', region: 'local' }), e => e.code === 'already_queued_or_playing');
  assert.throws(() => lobby.privateRooms.start(people[1].session), e => e.code === 'private_host_required');
  assert.throws(() => join(player(), group.code), e => e.code === 'private_room_full');
  const room = lobby.privateRooms.start(people[0].session);
  assert(room.private); assert.equal(room.mode, 'casual'); assert.equal(room.players.length, size * 2);
  assert.equal(room.players.filter(p => p.team === 0).length, size);
  assert.equal(new Set(room.players.map(p => p.id)).size, size * 2);
  assert.equal(lobby.privateRooms.groups.size, 0);
  assert.throws(() => lobby.privateRooms.start(people[0].session), e => e.code === 'not_in_private_room');
  assert.throws(() => join(player(), group.code), e => e.code === 'private_room_unavailable');
  assert.equal(lobby.rooms.size, 1);
});
test('private codes and commands reject malformed or Ranked requests', () => {
  const { lobby, player, create, join } = fixture(), host = player(); create(host);
  for (const code of [null, '', 123, '<script>', 'IIIIIIII', 'AAAAAAAAA', '0AAAAAAA', ' '.repeat(100)]) assert.throws(() => normalizeInviteCode(code));
  const guest = player();
  assert.throws(() => join(guest, 'AAAAAAAA'), e => e.code === 'private_room_unavailable');
  for (const extra of [{ mode: 'ranked' }, { size: 4 }, { request: Infinity }, { visual: 'unknown' }]) {
    assert.throws(() => lobby.privateRooms.create(guest.session, { size: 1, request: 1, visual: 'fennec', ...extra }));
  }
  assert.equal(lobby.entries.size, 1);
});
test('private teams enforce capacity; host transfers when the host leaves', () => {
  const { lobby, player, create, join } = fixture(), host = player(), guest = player(), group = create(host, 2); join(guest, group.code);
  lobby.privateRooms.team(guest.session, 0);
  const third = player(); join(third, group.code);
  assert.throws(() => lobby.privateRooms.team(third.session, 0), e => e.code === 'private_team_full');
  assert.throws(() => lobby.privateRooms.team(third.session, 3), e => e.code === 'invalid_team');
  lobby.leave(host.session); assert.equal(group.hostId, guest.session.id); assert(!lobby.entries.has(host.session.id));
  lobby.leave(guest.session); lobby.leave(third.session); assert.equal(lobby.privateRooms.groups.size, 0);
});
test('waiting room refresh preserves identity; stale socket close cannot remove a replacement', () => {
  const { lobby, player, create } = fixture(), host = player(), group = create(host);
  lobby.detach(host.session, host.peer); assert(group.members.get(host.session.id).disconnectedAt !== null);
  const replacement = { messages: [], send(m) { this.messages.push(m); }, close() {} };
  lobby.attach(host.session, replacement); assert.equal(replacement.messages.at(-1).code, group.code);
  lobby.detach(host.session, host.peer);
  assert.equal(group.members.get(host.session.id).disconnectedAt, null);
  assert.equal(lobby.peers.get(host.session.id), replacement);
  const replacement2 = { send() {}, close() {} }; lobby.attach(host.session, replacement2);
  assert.equal(lobby.entries.size, 1);
});
test('grace expiry frees a slot and transfers host; TTL expires the entire room', () => {
  const { lobby, player, create, join } = fixture({ privateConfig: { graceMs: 100, ttlMs: 1000 } });
  const host = player(), guest = player(), group = create(host, 2); join(guest, group.code);
  lobby.detach(host.session, host.peer);
  const disconnected = group.members.get(host.session.id).disconnectedAt;
  lobby.update(disconnected + 101); assert(!lobby.entries.has(host.session.id)); assert.equal(group.hostId, guest.session.id);
  lobby.update(group.expiresAt + 1); assert.equal(lobby.entries.size, 0); assert.equal(lobby.privateRooms.groups.size, 0);
  assert.equal(guest.peer.messages.at(-1).type, 'private_closed');
});
test('private waiting/start capacity, cancel and shutdown are bounded', () => {
  const { lobby, player, create, join } = fixture({ maxRooms: 1, privateConfig: { maxLobbies: 1 } });
  const host = player(), guest = player(), group = create(host); join(guest, group.code);
  assert.throws(() => create(player()), e => e.code === 'private_lobbies_full');
  lobby.rooms.set('busy', { checkLifecycle() {}, cancel() {} });
  assert.throws(() => lobby.privateRooms.start(host.session), e => e.code === 'server_at_capacity');
  assert.equal(lobby.privateRooms.groups.size, 1, 'capacity error must retain the lobby');
  lobby.cancel(host.session, 999); assert(lobby.entries.has(host.session.id));
  lobby.cancel(host.session, 1); assert(!lobby.entries.has(host.session.id));
  lobby.shutdown(); assert.equal(lobby.privateRooms.groups.size, 0); assert.equal(lobby.entries.size, 0);
  assert.equal(guest.peer.messages.at(-1).reason, 'server_restart');
});
