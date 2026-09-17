// Frozen pre-fix client algorithm from ae12f86; test fixture only, never imported by the game.
import { STATE_LAYOUT as L, CAR_STATE as C, CAR_STATE_STRIDE as STRIDE } from '../../src/physics/state-layout.js';
import { controlsObject, NEUTRAL, reorderState, SIM_HZ } from '../../src/online/protocol.js';

// The shipped ABI exposes pose/velocity setters, not a complete rollback state.
// Prediction is corrected on every snapshot. Jump/suspension internals are
// approximated on restoration; the server always decides collisions/results.
export class Prediction {
  constructor(simulation, order) {
    this.sim = simulation; this.order = order; this.pointer = simulation.module._malloc(24 * 4);
    this.pending = []; this.latest = null; this.epoch = -1; this.accumulator = 0; this.last = 0;
    this.lastSend = 0; this.seq = 0; this.samples = []; this.corrections = 0; this.error = 0;
  }
  restore(state) {
    const m = this.sim.module, scratch = this.pointer / 4;
    m.HEAPF32.set(state.subarray(L.BALL, L.BALL + 18), scratch);
    m._physics_setBallState(this.pointer);
    for (let slot = 0; slot < this.order.length; slot++) {
      const at = L.CARS + slot * STRIDE;
      m.HEAPF32.fill(0, scratch, scratch + 24);
      m.HEAPF32.set(state.subarray(at, at + 19), scratch);
      m.HEAPF32[scratch + 19] = state[at + C.ON_GROUND];
      m.HEAPF32[scratch + 20] = +(state[at + C.ON_GROUND] !== 1);
      m.HEAPF32[scratch + 21] = +(state[at + C.HAS_FLIP_OR_JUMP] !== 1);
      m.HEAPF32[scratch + 22] = state[at + C.IS_FLIPPING];
      if (m._physics_setCarState(slot, this.pointer) !== 1) throw Error('Prediction state restoration failed');
      this.sim.setControls(slot, controlsObject(NEUTRAL));
    }
    this.sim.step(0);
  }
  receive(snapshot, self, now = performance.now()) {
    if (this.latest && snapshot.tick < this.latest.tick && snapshot.epoch <= this.epoch) return;
    const state = reorderState(snapshot.state, this.order), reset = snapshot.epoch !== this.epoch;
    this.latest = snapshot; this.epoch = snapshot.epoch;
    this.seq = Math.max(this.seq, snapshot.acknowledgements[self]);
    this.pending = reset ? [] : this.pending.filter(p => p.seq > snapshot.acknowledgements[self] && now - p.at < 1000).slice(-60);
    if (reset) { this.samples.length = 0; this.accumulator = 0; }
    const previous = this.sim.state.slice(L.CARS, L.CARS + 3);
    this.restore(state);
    if (snapshot.match.phase === 'playing') for (const packet of this.pending) {
      this.sim.setControls(0, controlsObject(packet.controls)); this.sim.step(packet.ticks);
    }
    this.error = Math.hypot(...previous.map((v, i) => v - this.sim.state[L.CARS + i]));
    if (!reset && this.error > 5) this.corrections++;
    this.samples.push({ at: now, state }); if (this.samples.length > 24) this.samples.shift();
    this.last = now;
  }
  update(now, controls, send, clock, connected) {
    if (!this.latest) return;
    const elapsed = this.last ? Math.max(0, Math.min(100, now - this.last)) : 0; this.last = now;
    const playing = connected && this.latest.match.phase === 'playing';
    if (playing) {
      this.accumulator += elapsed;
      let ticks = Math.min(12, Math.floor(this.accumulator / (1000 / SIM_HZ)));
      this.accumulator -= ticks * (1000 / SIM_HZ);
      if (ticks) {
        if (now - this.lastSend >= 1000 / 60 - 1) {
          this.seq++; this.lastSend = now;
          const packet = { seq: this.seq, controls: [...controls], ticks: 0, at: now };
          this.pending.push(packet); if (this.pending.length > 60) this.pending.shift();
          send(this.seq, packet.controls);
        }
        const packet = this.pending.at(-1);
        if (packet) { packet.ticks = Math.min(12, packet.ticks + ticks); this.sim.setControls(0, controlsObject(packet.controls)); }
        else this.sim.setControls(0, controlsObject(NEUTRAL));
        this.sim.step(ticks);
      }
    } else this.accumulator = 0;
    const target = now - 100;
    let lower = this.samples[0], upper = this.samples.at(-1);
    for (let i = 1; i < this.samples.length; i++) if (this.samples[i].at >= target) { lower = this.samples[i - 1]; upper = this.samples[i]; break; }
    if (!lower || !upper) return;
    clock.prevState.set(lower.state); clock.currState.set(upper.state);
    clock.alpha = upper.at === lower.at ? 1 : Math.min(1, Math.max(0, (target - lower.at) / (upper.at - lower.at)));
    const pose = this.sim.state.subarray(L.CARS, L.CARS + 18);
    if (playing) {
      clock.prevState.set(pose, L.CARS); clock.currState.set(pose, L.CARS);
      const wheels = this.sim.state.subarray(L.CARS + C.WHEELS, L.CARS + C.WHEELS + 12);
      clock.prevState.set(wheels, L.CARS + C.WHEELS); clock.currState.set(wheels, L.CARS + C.WHEELS);
    }
    clock.lastTicks = 0; clock.lastDropped = 0; clock.tick = this.latest.tick;
  }
  dispose() { this.sim.module._free(this.pointer); this.pending.length = this.samples.length = 0; this.latest = null; }
}
