import { NETWORK_CORE_SHA256 } from '../src/physics/network-core.js';
import { InputStream } from './input-stream.mjs';
import { randomUUID } from 'node:crypto';
import { NativeArena } from './native.mjs';
import { MatchSession } from '../src/match/session.js';
import { NEUTRAL, SIM_HZ, SNAPSHOT_HZ, PROTOCOL, PHYSICS_SHA256, encodeSnapshot, validControls, validSequence } from '../src/online/protocol.js';
import { STATE_LAYOUT } from '../src/physics/state-layout.js';
import { initialRating, rateTeams } from './rating.mjs';
import { PublicError } from './limits.mjs';

export class Room {
  constructor({ players, size, mode, region, store, sessions, peerFor, onDispose, config = {}, privateRoom = false }) {
    this.id = randomUUID(); this.players = players; this.size = size; this.mode = mode; this.region = region; this.private = privateRoom;
    this.store = store; this.sessions = sessions; this.peerFor = peerFor; this.onDispose = onDispose;
    this.config = { graceMs: 30000, readyMs: 60000, staleInputMs: 250, afkWarnMs: 150000, afkMs: 180000, ...config };
    this.born = performance.now(); this.startedAt = null; this.active = false; this.terminal = false;
    this.tick = 0; this.epoch = 0; this.ready = new Set(); this.forfeits = new Set(); this.resultLeavers = new Set();
    this.match = new MatchSession(); this.match.start(); this.match.state.phase = 'waiting';
    this.slots = players.map(p => ({ id: p.id, connected: true, disconnectedAt: null, lastInput: -Infinity, lastActivity: this.born,
      lastSeq: 0, ack: 0, controls: [...NEUTRAL], abandoned: false, reason: null, warned: false, stream: new InputStream({ staleMs: this.config.staleInputMs }) }));
    this.busy = false; this.nextPersistence = 0; this.result = null; this.reservedInStore = false;
  }
  publicRoster() { return this.players.map((p, slot) => ({ slot, id: p.id, name: p.name, team: p.team, visual: p.visual, testClient: !!p.isTest })); }
  send(id, message) { this.peerFor(id)?.send(message); }
  broadcast(message) { for (const p of this.players) this.send(p.id, message); }
  async prepare() {
    try {
      this.arena = await NativeArena.create(this.players);
      if (this.terminal) { this.arena.dispose(); this.arena = null; return; }
      if (this.store) { await this.store.reserve(this); this.reservedInStore = true; }
      if (this.terminal) { await this.store?.cancel(this.id, this.cancelReason ?? 'search_cancelled'); return; }
      for (const player of this.players) this.admit(player.id);
    } catch { this.cancel('server_unavailable'); }
  }
  admit(id) {
    const slot = this.slots.findIndex(p => p.id === id);
    if (slot < 0 || !this.arena) return;
    this.send(id, { type: 'reserved', matchId: this.id, mode: this.mode, size: this.size, region: this.region, private: this.private,
      protocol: PROTOCOL, physics: PHYSICS_SHA256, nativeCheckpoint: this.peerFor(id)?.nativeCheckpoint ? 1 : 0, nativePhysics: this.peerFor(id)?.nativeCheckpoint ? NETWORK_CORE_SHA256 : undefined, roster: this.publicRoster(), configs: this.arena.configs,
      self: slot, ack: this.slots[slot].ack, graceMs: this.config.graceMs, reconnect: this.active || this.terminal });
    this.sendSnapshot(id);
    if (this.result) this.send(id, { type: 'result', ...this.result });
    else if (this.terminal) this.send(id, { type: 'result_pending', matchId: this.id });
  }
  async markReady(id) {
    if (this.terminal || !this.arena) return;
    const player = this.players.find(p => p.id === id);
    if (!player) throw new PublicError('not_in_match');
    if (this.mode === 'ranked') await this.sessions.requireRanked(player.session);
    if (this.terminal || !this.slots.find(p => p.id === id)?.connected) return;
    this.ready.add(id);
    this.broadcast({ type: 'waiting', ready: this.ready.size, required: this.players.length });
    if (this.active || this.activating || this.ready.size !== this.players.length || this.slots.some(p => !p.connected)) return;
    this.activating = true;
    try {
      await this.store?.activate(this.id);
      if (this.terminal || this.slots.some(p => !p.connected)) return;
      this.active = true; this.startedAt = performance.now(); this.match.start(); this.arena.reset(); this.epoch++; for (const slot of this.slots) { slot.stream.clear(); slot.ack = slot.stream.seq; }
      for (const slot of this.slots) slot.lastActivity = this.startedAt;
      this.broadcast({ type: 'kickoff', matchId: this.id }); this.sendSnapshot();
    } catch { this.cancel('database_unavailable'); }
    finally { this.activating = false; }
  }
  input(id, seq, values, now = performance.now(), epoch = this.epoch) {
    const index = this.slots.findIndex(p => p.id === id), slot = this.slots[index];
    if (!slot || !slot.connected || slot.abandoned || this.terminal) return;
    if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > this.epoch) throw new PublicError('invalid_input');
    if (epoch !== this.epoch || this.match.state.phase !== 'playing') return;
    if (!validSequence(seq) || !validControls(values) || seq > slot.lastSeq + 2400) throw new PublicError('invalid_input');
    if (seq <= slot.lastSeq) return;
    slot.stream.push(seq, values, now);
    slot.lastSeq = seq; slot.controls = values; slot.lastInput = now;
    if (values.some(v => v !== 0)) { slot.lastActivity = now; slot.warned = false; }
  }
  disconnect(id, now = performance.now(), voluntary = false) {
    const index = this.slots.findIndex(p => p.id === id), slot = this.slots[index];
    if (!slot || !slot.connected) return;
    slot.connected = false; slot.disconnectedAt = voluntary ? now - this.config.graceMs : now;
    slot.controls = [...NEUTRAL]; slot.stream.clear(); this.arena?.input(index);
    slot.reason = voluntary ? 'left_match' : 'connection_lost';
    if (!this.active || this.startedAt !== null && this.match.state.phase === 'kickoff' && this.tick < 3 * SIM_HZ) { this.cancel('player_left_before_kickoff'); return; }
    this.broadcast({ type: 'player_disconnected', slot: index, graceMs: voluntary ? 0 : this.config.graceMs });
  }
  reconnect(id, now = performance.now()) {
    const slot = this.slots.find(p => p.id === id);
    if (!slot || slot.abandoned || slot.disconnectedAt !== null && now - slot.disconnectedAt >= this.config.graceMs && !this.terminal) throw new PublicError('reconnect_expired');
    slot.connected = true; slot.disconnectedAt = null; slot.lastInput = -Infinity; slot.stream.clear(); slot.ack=slot.stream.seq;
    this.admit(id);
    this.broadcast({ type: 'player_reconnected', slot: this.slots.indexOf(slot) });
  }
  forfeit(id, now = performance.now()) {
    const player = this.players.find(p => p.id === id);
    if (!player || !this.active || this.terminal) throw new PublicError('not_in_match');
    if (this.mode === 'ranked' && now - this.startedAt < 60000) throw new PublicError('forfeit_too_early', 'Ranked forfeits unlock after one minute.');
    this.forfeits.add(id);
    const team = this.players.filter(p => p.team === player.team);
    const votes = team.filter(p => this.forfeits.has(p.id) || this.slots.find(s => s.id === p.id).abandoned).length;
    this.broadcast({ type: 'forfeit_vote', team: player.team, votes, required: team.length });
    if (votes === team.length) this.finish(1 - player.team, 'forfeit');
  }
  checkLifecycle(now) {
    if (this.terminal) {
      if (!this.busy && !this.result && now >= this.nextPersistence) void this.persist();
      if (this.result && (now - this.resultAt > 60000 || this.resultLeavers.size === this.players.length)) this.dispose();
      return;
    }
    if (!this.active) { if (now - this.born > this.config.readyMs) this.cancel('ready_timeout'); return; }
    for (const [index, slot] of this.slots.entries()) {
      if (slot.connected && now - slot.lastActivity > this.config.afkWarnMs && !slot.warned) {
        slot.warned = true; this.send(slot.id, { type: 'afk_warning', seconds: Math.ceil((this.config.afkMs - this.config.afkWarnMs) / 1000) });
      }
      if (slot.connected && now - slot.lastActivity > this.config.afkMs) {
        this.disconnect(slot.id, now, true); slot.reason = 'afk'; this.send(slot.id, { type: 'afk_removed' });
      }
      if (!slot.connected && !slot.abandoned && now - slot.disconnectedAt >= this.config.graceMs) {
        slot.abandoned = true; this.arena.input(index); this.send(slot.id, { type: 'reconnect_expired' });
      }
    }
    const gone = [0, 1].map(team => this.players.filter(p => p.team === team).every(p => this.slots.find(s => s.id === p.id).abandoned));
    if (gone[0] || gone[1]) {
      if (gone[0] && gone[1]) {
        const times = [0, 1].map(team => Math.max(...this.players.filter(p => p.team === team).map(p => this.slots.find(s => s.id === p.id).disconnectedAt)));
        if (times[0] === times[1] && this.match.state.blueScore === this.match.state.orangeScore) this.cancel('all_players_left_tied');
        else this.finish(times[0] === times[1] ? +(this.match.state.orangeScore > this.match.state.blueScore) : +(times[0] < times[1]), 'team_abandoned');
      } else this.finish(gone[0] ? 1 : 0, 'team_abandoned');
    }
  }
  step(now = performance.now(), deferSnapshots = false) {
    if (!this.active || this.terminal || !this.arena) return;
    this.tick++;
    const state = this.match.state;
    if (state.phase === 'playing') {
      this.slots.forEach((slot, index) => {
        this.arena.input(index, slot.connected && !slot.abandoned ? slot.stream.step(now) : NEUTRAL);
        slot.ack = slot.stream.seq;
      });
      this.arena.step();
      const native = this.arena.state;
      if (!native.every(Number.isFinite)) { this.cancel('invalid_simulation'); return; }
      const event = this.match.tick({ goal: this.arena.goal(), ballOnGround: this.arena.ballOnGround,
        kickoffTouched: Math.abs(native[STATE_LAYOUT.BALL]) + Math.abs(native[STATE_LAYOUT.BALL + 1]) > 1 || Math.hypot(native[STATE_LAYOUT.BALL + 12], native[STATE_LAYOUT.BALL + 13]) > 1 });
      if (event === 'kickoff') { this.arena.reset(); this.epoch++; for (const slot of this.slots) { slot.stream.clear(); slot.ack = slot.stream.seq; } }
    } else if (this.match.tick() === 'kickoff') { this.arena.reset(); this.epoch++; for (const slot of this.slots) { slot.stream.clear(); slot.ack = slot.stream.seq; } }
    if (state.phase === 'ended') this.finish(state.winner, 'full_time');
    if (this.tick % (SIM_HZ / SNAPSHOT_HZ) === 0) {
      if (deferSnapshots) this.snapshotDue = true;
      else this.sendSnapshot();
    }
  }
  flushSnapshot() {
    if (!this.snapshotDue) return;
    this.snapshotDue = false; this.sendSnapshot();
  }
  sendSnapshot(id) {
    if (!this.arena) return;
    const values = { tick: this.tick, epoch: this.epoch, time: performance.now(), state: this.arena.state, match: this.match.state,
      acknowledgements: this.slots.map(s => s.ack), inputStates: this.slots.map(s => s.stream.metadata()) };
    let legacy, extended;
    for (const player of id ? [{ id }] : this.players) {
      const peer = this.peerFor(player.id); if (!peer) continue;
      const binary = peer.nativeCheckpoint
        ? (extended ??= encodeSnapshot({ ...values, checkpoint: this.arena.checkpoint }))
        : (legacy ??= encodeSnapshot(values));
      peer.sendBinary(binary); this.lastSnapshotBytes = binary.byteLength;
    }
  }

  finish(winner, reason) {
    if (this.terminal || ![0, 1].includes(winner)) return;
    this.terminal = true; this.match.state.phase = 'ended'; this.match.state.winner = winner;
    this.outcome = { matchId: this.id, mode: this.mode, playlist: this.size, winner, reason,
      blueScore: this.match.state.blueScore, orangeScore: this.match.state.orangeScore,
      abandoned: this.slots.filter(s => s.abandoned || !s.connected && s.reason === 'left_match').map(s => ({ id: s.id, reason: s.reason ?? 'connection_lost' })) };
    this.broadcast({ type: 'result_pending', matchId: this.id }); this.sendSnapshot(); void this.persist();
  }
  cancel(reason) {
    if (this.terminal) return;
    this.terminal = true; this.cancelReason = reason; this.match.state.phase = 'ended';
    this.broadcast({ type: 'cancelled', matchId: this.id, reason, rated: false }); void this.persist();
  }
  async persist() {
    if (this.busy || this.result) return;
    this.busy = true;
    try {
      if (this.cancelReason) this.result = this.reservedInStore ? await this.store.cancel(this.id, this.cancelReason) : { status: 'cancelled', reason: this.cancelReason, changes: [] };
      else if (this.store) this.result = await this.store.finalize(this.id, this.outcome);
      else {
        if (this.mode !== 'casual') throw new Error('Ranked requires durable storage');
        this.result = { ...this.outcome, status: 'completed', changes: [] };
      }
      if (!this.cancelReason && this.mode === 'casual' && !this.private && !this.players.some(p => p.isTest)) {
        const changes = rateTeams(this.players.map(p => ({ id: p.id, team: p.team, ...(p.session.casual.get(this.size) ?? initialRating()) })), this.outcome.winner, undefined, true);
        for (const change of changes) this.players.find(p => p.id === change.id).session.casual.set(this.size, change.after);
      }
      this.resultAt = performance.now();
      this.broadcast({ type: 'result', ...this.result, matchId: this.id });
      if (this.cancelReason) queueMicrotask(() => this.dispose());
    } catch {
      this.nextPersistence = performance.now() + 3000;
      this.broadcast({ type: 'result_pending', matchId: this.id, reason: 'database_unavailable' });
    } finally { this.busy = false; }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.arena?.dispose(); this.arena = null; this.onDispose(this);
  }
}
