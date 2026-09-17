import { randomBytes } from 'node:crypto';
import { CAR_VISUALS } from '../src/online/protocol.js';
import { initialRating } from './rating.mjs';
import { PublicError } from './limits.mjs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function normalizeInviteCode(value) {
  if (typeof value !== 'string' || value.length > 32) throw new PublicError('invalid_invite_code');
  const code = value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new PublicError('invalid_invite_code');
  return code;
}

// Waiting lobbies allocate no native arenas. Membership shares the public queue's
// identity lock; a code never authorizes controls for another user's car.
export class PrivateRooms {
  constructor(lobby, { maxLobbies = 16, ttlMs = 600000, graceMs = 30000 } = {}) {
    this.lobby = lobby; this.groups = new Map();
    this.maxLobbies = maxLobbies; this.ttlMs = ttlMs; this.graceMs = graceMs;
  }
  available(session, message) {
    const lobby = this.lobby;
    if (lobby.stopping || lobby.initializing) throw new PublicError('server_unavailable');
    if (!lobby.peers.has(session.id)) throw new PublicError('sign_in_required');
    if (lobby.entries.has(session.id)) throw new PublicError('already_queued_or_playing');
    if (lobby.entries.size >= lobby.maxQueue) throw new PublicError('server_at_capacity');
    if (!CAR_VISUALS.includes(message.visual) || !Number.isSafeInteger(message.request) || message.request < 1) throw new PublicError('invalid_private_room');
    if (message.mode !== undefined && message.mode !== 'casual') throw new PublicError('private_casual_only');
  }
  create(session, message, now = performance.now()) {
    this.available(session, message);
    if (![1, 2, 3].includes(message.size)) throw new PublicError('invalid_private_room');
    if (this.groups.size >= this.maxLobbies) throw new PublicError('private_lobbies_full');
    let code;
    do { code = [...randomBytes(8)].map(byte => ALPHABET[byte & 31]).join(''); } while (this.groups.has(code));
    const group = { code, size: message.size, hostId: session.id, expiresAt: now + this.ttlMs, members: new Map() };
    this.groups.set(code, group);
    this.add(group, session, message, 0); this.broadcast(group, now);
    return group;
  }
  join(session, message, now = performance.now()) {
    this.available(session, message);
    const code = normalizeInviteCode(message.code), group = this.groups.get(code);
    if (!group) throw new PublicError('private_room_unavailable');
    if (now >= group.expiresAt) { this.close(group, 'private_room_expired'); throw new PublicError('private_room_unavailable'); }
    if (group.members.size >= group.size * 2) throw new PublicError('private_room_full');
    const counts = [0, 1].map(team => [...group.members.values()].filter(p => p.team === team).length);
    this.add(group, session, message, counts[0] <= counts[1] ? 0 : 1);
    this.broadcast(group, now); return group;
  }
  add(group, session, message, team) {
    const entry = { id: session.id, name: session.name, accountId: session.accountId, isTest: session.isTest, session,
      mode: 'casual', size: group.size, visual: message.visual, request: message.request, region: this.lobby.region,
      rating: initialRating(), status: 'private', privateGroup: group, team, disconnectedAt: null };
    group.members.set(entry.id, entry); this.lobby.entries.set(entry.id, entry); session.active = true;
  }
  groupFor(session, now = performance.now()) {
    const group = this.lobby.entries.get(session.id)?.privateGroup;
    if (!group || this.groups.get(group.code) !== group) throw new PublicError('not_in_private_room');
    if (now >= group.expiresAt) { this.close(group, 'private_room_expired'); throw new PublicError('private_room_expired'); }
    return group;
  }
  broadcast(group, now = performance.now()) {
    const roster = [...group.members.values()].map(p => ({ id: p.id, name: p.name, team: p.team, visual: p.visual,
      connected: p.disconnectedAt === null && this.lobby.peers.has(p.id) }));
    const canStart = roster.length === group.size * 2 && roster.every(p => p.connected) && [0, 1].every(team => roster.filter(p => p.team === team).length === group.size);
    for (const member of group.members.values()) this.lobby.peers.get(member.id)?.send({ type: 'private_room', code: group.code,
      mode: 'casual', size: group.size, region: this.lobby.region, hostId: group.hostId, self: member.id, roster, canStart,
      graceMs: this.graceMs, expiresInSeconds: Math.max(0, Math.ceil((group.expiresAt - now) / 1000)), rated: false });
  }
  team(session, team) {
    if (![0, 1].includes(team)) throw new PublicError('invalid_team');
    const group = this.groupFor(session), entry = group.members.get(session.id);
    if (entry.team === team) return;
    if ([...group.members.values()].filter(p => p.team === team).length >= group.size) throw new PublicError('private_team_full');
    entry.team = team; this.broadcast(group);
  }
  start(session, now = performance.now()) {
    const lobby = this.lobby, group = this.groupFor(session, now);
    if (lobby.stopping || lobby.initializing) throw new PublicError('server_unavailable');
    if (group.hostId !== session.id) throw new PublicError('private_host_required');
    const players = [...group.members.values()];
    if (players.length !== group.size * 2 || players.some(p => p.disconnectedAt !== null || !lobby.peers.has(p.id)) ||
      [0, 1].some(team => players.filter(p => p.team === team).length !== group.size)) throw new PublicError('private_players_not_ready');
    if (lobby.rooms.size >= lobby.maxRooms) throw new PublicError('server_at_capacity');
    // Consume the code synchronously: repeated start/join cannot allocate twice.
    const room = new lobby.RoomClass({ players: [...players].sort((a, b) => a.team - b.team), size: group.size,
      mode: 'casual', region: lobby.region, privateRoom: true, store: lobby.store, sessions: lobby.sessions,
      peerFor: id => lobby.peers.get(id), onDispose: r => lobby.releaseRoom(r), config: lobby.roomConfig });
    this.groups.delete(group.code); lobby.rooms.set(room.id, room);
    for (const player of players) {
      delete player.privateGroup; player.room = room; player.status = 'reserved';
      lobby.peers.get(player.id)?.send({ type: 'loading', request: player.request, matchId: room.id, private: true });
    }
    void room.prepare(); return room;
  }
  attach(session, now = performance.now()) {
    const group = this.groupFor(session, now), entry = group.members.get(session.id);
    if (entry.disconnectedAt !== null && now - entry.disconnectedAt >= this.graceMs) {
      this.leave(session, now); throw new PublicError('reconnect_expired');
    }
    entry.disconnectedAt = null; this.broadcast(group, now);
  }
  detach(session, now = performance.now()) {
    const entry = this.lobby.entries.get(session.id);
    if (!entry?.privateGroup) return;
    entry.disconnectedAt = now; this.broadcast(entry.privateGroup, now);
  }
  leave(session, now = performance.now()) {
    const entry = this.lobby.entries.get(session.id), group = entry?.privateGroup;
    if (!group) return;
    group.members.delete(session.id); this.lobby.entries.delete(session.id); delete entry.privateGroup;
    session.active = this.lobby.peers.has(session.id);
    if (!group.members.size) { this.groups.delete(group.code); return; }
    if (group.hostId === session.id) group.hostId = [...group.members.values()].find(p => p.disconnectedAt === null)?.id ?? group.members.keys().next().value;
    this.broadcast(group, now);
  }
  close(group, reason) {
    this.groups.delete(group.code);
    for (const member of group.members.values()) {
      if (this.lobby.entries.get(member.id)?.privateGroup !== group) continue;
      this.lobby.peers.get(member.id)?.send({ type: 'private_closed', reason, rated: false });
      this.lobby.entries.delete(member.id); delete member.privateGroup; member.session.active = this.lobby.peers.has(member.id);
    }
    group.members.clear();
  }
  update(now) {
    for (const group of this.groups.values()) {
      if (now >= group.expiresAt) { this.close(group, 'private_room_expired'); continue; }
      for (const member of [...group.members.values()]) if (member.disconnectedAt !== null && now - member.disconnectedAt >= this.graceMs) this.leave(member.session, now);
    }
  }
  shutdown(reason) { for (const group of this.groups.values()) this.close(group, reason); }
}
