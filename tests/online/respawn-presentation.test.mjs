import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeArena } from '../../server/native.mjs';
import { Prediction } from '../../src/online/prediction.js';
import { applyConfirmedLifecycle } from '../../src/online/presentation-lifecycle.js';
import { STATE_LAYOUT as L, CAR_STATE as C, CAR_STATE_STRIDE as S } from '../../src/physics/state-layout.js';
import { controlsArray, NEUTRAL, encodeSnapshot, decodeSnapshot } from '../../src/online/protocol.js';

const match = { phase: 'playing', overtime: false, winner: null, scorer: null, blueScore: 0, orangeScore: 0,
  remainingSeconds: 300, overtimeSeconds: 0, countdown: 0 };
function snapshot(arena, tick) {
  return decodeSnapshot(encodeSnapshot({ tick, epoch: 1, state: arena.state, checkpoint: arena.checkpoint,
    acknowledgements: [0, 0], match }));
}
function restoreFixture(arena, state, checkpoint) {
  const m = arena.module, n = checkpoint.length, p = m._malloc((510 + n + 2) * 4);
  try {
    m.HEAPF32.set(state, p / 4); m.HEAPF32.set(checkpoint, p / 4 + 510);
    m.HEAP32.set([0, 1], p / 4 + 510 + n);
    assert.equal(m._physics_restoreNetState(p, p + 510 * 4, n, p + (510 + n) * 4), 1);
  } finally { m._free(p); }
}

test('confirmed lifecycle uses the correct reordered player and never mutates authoritative physics', () => {
  const authoritative = new Float32Array(510), rendered = authoritative.slice();
  authoritative[L.CARS + S + C.DEMOED] = 1;
  authoritative[L.CARS + S] = 750;
  rendered[L.CARS] = -2304;
  const preserved = authoritative.slice();
  assert(applyConfirmedLifecycle(rendered, authoritative, 1));
  assert.equal(rendered[L.CARS], 750); assert.equal(rendered[L.CARS + C.DEMOED], 1);
  assert.deepEqual(authoritative, preserved);
  authoritative[L.CARS + S + C.DEMOED] = 0;
  rendered[L.CARS] = 900; rendered[L.CARS + C.DEMOED] = 1;
  assert(!applyConfirmedLifecycle(rendered, authoritative, 1));
  assert.equal(rendered[L.CARS], 900, 'ordinary predicted movement is untouched');
  assert.equal(rendered[L.CARS + C.DEMOED], 0, 'unconfirmed demolition does not hide the car');
});

test('native random respawn stays invisible until confirmed; the camera never follows the speculative spawn', async () => {
  const arena = await NativeArena.create([{ team: 0, visual: 'fennec' }, { team: 1, visual: 'fennec' }]);
  let prediction;
  try {
    const state = arena.state.slice(), checkpoint = arena.checkpoint.slice();
    state[L.CARS + C.DEMOED] = 1; checkpoint[24 + 29] = .0125;
    restoreFixture(arena, state, checkpoint);
    const authoritative = snapshot(arena, 1);
    const sim = { module: arena.module, get state() { return arena.state; },
      setControls(i, controls) { arena.input(i, controlsArray(controls)); }, step(n) { arena.module._physics_step(n); } };
    prediction = new Prediction(sim, [0, 1]);
    const clock = { prevState: arena.state.slice(), currState: arena.state.slice() };
    prediction.receive(authoritative, 0, 0);
    for (let frame = 0; frame < 6; frame++) {
      prediction.update(frame * 1000 / 60, NEUTRAL, () => {}, clock, true);
      assert.equal(clock.currState[L.CARS + C.DEMOED], 1);
      assert.deepEqual(clock.currState.slice(L.CARS, L.CARS + 3), authoritative.state.slice(L.CARS, L.CARS + 3),
        'visible/camera position must not jump to an independently random respawn');
    }
    assert.equal(arena.state[L.CARS + C.DEMOED], 0, 'fixture genuinely crosses native respawn, not a mocked visibility flag');
    const confirmedState = arena.state.slice(), confirmedHidden = arena.checkpoint.slice();
    // Deliberately choose the OTHER legal side in the authoritative test record.
    // There is no client command capable of doing this to the real server.
    confirmedState[L.CARS] = confirmedState[L.CARS] > 0 ? -2304 : 2304;
    restoreFixture(arena, confirmedState, confirmedHidden);
    const confirmed = snapshot(arena, 20);
    prediction.receive(confirmed, 0, 100);
    prediction.update(100, NEUTRAL, () => {}, clock, true);
    assert.equal(clock.currState[L.CARS + C.DEMOED], 0);
    assert(Math.abs(clock.currState[L.CARS] - confirmed.state[L.CARS]) < 1);
    assert.equal(prediction.metrics().authoritativeLifecycleChanges, 1);
    assert.equal(prediction.localVisual.hardSnaps, 0, 'confirmed spawn is a lifecycle transition, not an unexplained correction');
  } finally { prediction?.dispose(); arena.dispose(); }
});
