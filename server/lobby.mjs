import { Room } from './room.mjs';
import { CAR_VISUALS } from '../src/online/protocol.js';
import { initialRating } from './rating.mjs';
import { PublicError } from './limits.mjs';

export function balancedTeams(entries, size) {
  let best, score = Infinity;
  // At most C(6,3) = 20 assignments. Slot zero anchors blue to break symmetry.
  for (let mask = 1; mask < 1 << entries.length; mask += 2) {
    const left = entries.filter((_, i) => mask & (1 << i));
    if (left.length !== size) continue;
    const right = entries.filter((_, i) => !(mask & (1 << i)));
    const difference = Math.abs(left.reduce((s, p) => s + p.rating.mu, 0) - right.reduce((s, p) => s + p.rating.mu, 0));
    if (difference < score) { score = difference; best = [...left.map(p => ({ ...p, team: 0 })), ...right.map(p => ({ ...p, team: 1 }))]; }
  }
  return best;
}
export class Lobby {
  constructor({ sessions, store = null, region = 'local', maxRooms = 2, maxQueue = 128, roomConfig = {}, RoomClass = Room }) {
    this.sessions = sessions; this.store = store; this.region = region; this.maxRooms = maxRooms; this.maxQueue = maxQueue;
    this.roomConfig = roomConfig; this.RoomClass = RoomClass;
    this.peers = new Map(); this.entries = new Map(); this.rooms = new Map(); this.stopping = false;
  }
  attach(session, peer) {
    const old = this.peers.get(session.id);
    this.peers.set(session.id, peer); peer.session = session; session.active = true;
    if (old && old !== peer) old.close(4001, 'session_replaced');
    const entry = this.entries.get(session.id);
    if (entry?.room) entry.room.reconnect(session.id);
    else peer.send({ type: 'connected', player: this.sessions.public(session), region: this.region, ranked: this.sessions.configured });
  }
  detach(session, peer) {
    if (this.peers.get(session.id) !== peer) return;
    this.peers.delete(session.id);
    const entry = this.entries.get(session.id);
    if (entry?.room) entry.room.disconnect(session.id);
    else { this.entries.delete(session.id); session.active = false; }
  }
  async join(session, { mode, size, visual, request, region }) {
    if (this.stopping) throw new PublicError('server_unavailable');
    if (!['casual', 'ranked'].includes(mode) || ![1, 2, 3].includes(size) || !CAR_VISUALS.includes(visual) || !Number.isSafeInteger(request) || request < 1) throw new PublicError('invalid_queue');
    if (region !== this.region) throw new PublicError('region_unavailable');
    if (this.entries.has(session.id)) throw new PublicError('already_queued_or_playing');
    if (this.entries.size >= this.maxQueue) throw new PublicError('server_at_capacity');
    const entry = { id: session.id, name: session.name, accountId: session.accountId, isTest: session.isTest, session,
      mode, size, visual, request, region, status: 'validating', since: performance.now() };
    this.entries.set(session.id, entry);
    try {
      if (mode === 'ranked') await this.sessions.requireRanked(session);
      const rating = session.accountId && this.store ? await this.store.ratingFor(session.accountId, size, mode) : session.casual.get(size) ?? initialRating();
      if (this.entries.get(session.id) !== entry || !this.peers.has(session.id)) return;
      entry.rating = rating; entry.status = 'queued';
      this.peers.get(session.id).send({ type: 'searching', request, mode, size, region });
      this.matchmake();
    } catch (error) { if (this.entries.get(session.id) === entry) this.entries.delete(session.id); throw error; }
  }
  cancel(session, request) {
    const entry = this.entries.get(session.id);
    if (entry && entry.request === request) {
      if (entry.room) {
        if (!entry.room.active) { entry.room.cancel('search_cancelled'); this.releaseRoom(entry.room); }
        else throw new PublicError('match_already_started');
      } else this.entries.delete(session.id);
    }
    this.peers.get(session.id)?.send({ type: 'search_cancelled', request });
  }
  leave(session) {
    const entry = this.entries.get(session.id);
    if (entry?.room) {
      const room = entry.room;
      if (room.result) { room.resultLeavers.add(session.id); this.entries.delete(session.id); session.active = this.peers.has(session.id); }
      else if (!room.active) { room.cancel('player_left_before_kickoff'); this.releaseRoom(room); }
      else { room.disconnect(session.id, performance.now(), true); this.peers.get(session.id)?.send({ type: 'left_match', pendingResult: true }); }
    } else this.entries.delete(session.id);
  }
  roomFor(session, matchId) {
    const room = this.entries.get(session.id)?.room;
    if (!room || room.id !== matchId) throw new PublicError('not_in_match');
    return room;
  }
  matchmake(now = performance.now()) {
    if (this.stopping) return;
    for (const mode of ['casual', 'ranked']) for (const size of [1, 2, 3]) {
      const waiting = [...this.entries.values()].filter(p => p.status === 'queued' && p.mode === mode && p.size === size);
      for (const oldest of waiting) {
        if (this.rooms.size >= this.maxRooms) {
          for (const p of waiting) if (!p.capacityNotified) { this.peers.get(p.id)?.send({ type: 'capacity', request: p.request }); p.capacityNotified = true; }
          break;
        }
        if (oldest.status !== 'queued') continue;
        const range = p => mode === 'ranked' ? Math.min(400, 100 + 25 * Math.floor((now - p.since) / 15000)) : Math.min(800, 300 + 100 * Math.floor((now - p.since) / 15000));
        const pool = waiting.filter(p => (this.peers.get(p.id)?.rtt ?? 0) <= 500 && p.status === 'queued' && Math.abs(p.rating.mu - oldest.rating.mu) <= Math.min(range(p), range(oldest)));
        if (pool.length < 2 * size) continue;
        const selected = pool.slice(0, 2 * size), players = balancedTeams(selected, size);
        const room = new this.RoomClass({ players, size, mode, region: this.region, store: this.store, sessions: this.sessions,
          peerFor: id => this.peers.get(id), onDispose: r => this.releaseRoom(r), config: this.roomConfig });
        this.rooms.set(room.id, room);
        for (const p of selected) { p.status = 'reserved'; p.room = room; this.peers.get(p.id)?.send({ type: 'loading', request: p.request, matchId: room.id }); }
        void room.prepare();
      }
    }
  }
  releaseRoom(room) {
    for (const p of room.players) {
      if (this.entries.get(p.id)?.room === room) this.entries.delete(p.id);
      p.session.active = this.peers.has(p.id);
    }
    // A preparing/persisting room retains resources until its async operation
    // finishes. Match locks are independent from the room's object lifetime.
    if (room.result && !room.busy) { this.rooms.delete(room.id); room.dispose(); }
  }
  update(now) { for (const room of this.rooms.values()) room.checkLifecycle(now); }
  step(now) { for (const room of this.rooms.values()) room.step(now); }
  shutdown(reason = 'server_restart') {
    this.stopping = true;
    for (const room of this.rooms.values()) if (!room.terminal) room.cancel(reason);
    for (const [id, entry] of this.entries) if (!entry.room) { this.peers.get(id)?.send({ type: 'cancelled', reason, rated: false }); this.entries.delete(id); }
  }
}
