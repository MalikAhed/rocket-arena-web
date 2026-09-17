import test from 'node:test';
import assert from 'node:assert/strict';
import { InputStream } from '../../server/input-stream.mjs';
import { Room } from '../../server/room.mjs';
import { Prediction } from '../../src/online/prediction.js';
import { SnapshotBuffer } from '../../src/online/snapshot-buffer.js';
import { VisualCorrection, writeQuaternion, quaternion, interpolateBody } from '../../src/online/pose.js';
import { STATE_LAYOUT as L } from '../../src/physics/state-layout.js';
import { PROTOCOL, NEUTRAL, STATE_SIZE, encodeSnapshot, decodeSnapshot } from '../../src/online/protocol.js';
import { scenario } from '../netcode/harness.mjs';
import { contactFixture, charge, aerial, opponent } from '../netcode/fixtures.mjs';
const moving = [1, 0, 0, 0, 0, 0, 0, 0];
const streamFactory = () => new InputStream();
function state() {
    const s = new Float32Array(STATE_SIZE);
    s[L.NUM_CARS] = 2;
    s[L.NUM_PADS] = 34;
    for (const at of [L.BALL, L.CARS, L.CARS + 51])
        writeQuaternion(s, at, [0, 0, 0, 1]);
    return s;
}
test('input stream: partial ACKs refer to consumed server ticks, and burst press/release edges survive', () => {
    const stream = new InputStream();
    stream.push(1, [1, 0, 0, 0, 0, 1, 0, 0], 0);
    stream.push(2, moving, 0);
    assert.equal(stream.step(0)[5], 1);
    assert.deepEqual([stream.metadata().seq, stream.metadata().ticks], [1, 1]);
    assert.equal(stream.step(8)[5], 1);
    assert.equal(stream.metadata().ticks, 2);
    assert.equal(stream.step(16)[5], 0);
    assert.deepEqual([stream.metadata().seq, stream.metadata().ticks], [2, 1]);
    assert.equal(stream.push(2, moving, 17), false);
    assert.equal(stream.step(1000), NEUTRAL);
    assert.equal(stream.queue.length, 0);
});
test('input stream: fixed durations, bounded backlog, validation, and no client-controlled simulation acceleration', () => {
    const stream = new InputStream();
    for (let i = 1; i <= 32; i++)
        stream.push(i, moving, 0);
    assert.throws(() => stream.push(33, moving, 0), e => e.code === 'input_backlog');
    const value = stream.step(0);
    assert.deepEqual(value, moving);
    assert.equal(stream.ticks, 1);
    assert.equal(stream.discarded, 30);
    assert.equal(stream.rebases, 1);
    assert.equal(stream.queue.length, 1, 'stale burst is dropped, not played at fast-forward speed');
    assert.throws(() => stream.push(24000, moving, 1), e => e.code === 'invalid_input');
    assert.throws(() => stream.push(33, [Infinity, ...NEUTRAL.slice(1)], 1), e => e.code === 'invalid_input');
    stream.clear();
    assert.deepEqual(stream.metadata().controls, NEUTRAL);
    assert.equal(stream.queue.length, 0);
});
test('input stream: regular 30 FPS two-command bursts are not discarded', () => {
    const stream = new InputStream();
    for (let frame = 0; frame < 100; frame++) {
        const time = frame * 1000 / 30;
        stream.push(frame * 2 + 1, moving, time);
        stream.push(frame * 2 + 2, moving, time);
        for (let tick = 0; tick < 4; tick++)
            stream.step(time + tick * 1000 / 120);
    }
    assert.equal(stream.discarded, 0);
    assert.equal(stream.metadata().seq, 200);
    assert.equal(stream.metadata().ticks, 2);
});
test('room: old kickoff inputs cannot leak into the new epoch; future epochs cannot control the server', () => {
    const players = [0, 1].map(team => ({ id: `test:${team}`, team }));
    const room = new Room({ players, size: 1, mode: 'casual', region: 'test', peerFor() { }, onDispose() { } });
    room.epoch = 4;
    room.match.state.phase = 'playing';
    room.input('test:0', 1, moving, 0, 3);
    assert.equal(room.slots[0].stream.queue.length, 0);
    assert.throws(() => room.input('test:0', 1, moving, 0, 5), e => e.code === 'invalid_input');
    room.input('test:0', 1, moving, 0, 4);
    assert.equal(room.slots[0].stream.queue.length, 1);
    room.match.state.phase = 'goal';
    room.input('test:0', 2, moving, 10, 4);
    assert.equal(room.slots[0].stream.queue.length, 1);
});
test('snapshot protocol v2 carries input durations and rejects old clients and malformed metadata', () => {
    const match = { phase: 'playing', overtime: false, winner: null, scorer: null, blueScore: 0, orangeScore: 0, remainingSeconds: 300, overtimeSeconds: 0, countdown: 0 };
    const binary = encodeSnapshot({ state: state(), tick: 12, epoch: 1, match, inputStates: [
            { seq: 7, ticks: 1, queued: 3, idle: 0, controls: moving }, { seq: 9, ticks: 2, queued: 2, idle: 0, controls: NEUTRAL }
        ] });
    const snapshot = decodeSnapshot(binary);
    assert.equal(PROTOCOL, 2);
    assert.equal(binary.byteLength, 888);
    assert.equal(snapshot.inputStates[0].ticks, 1);
    assert.deepEqual(snapshot.inputStates[0].controls, moving);
    new DataView(binary).setUint8(44, 3);
    assert.throws(() => decodeSnapshot(binary), /invalid_snapshot/);
    new DataView(binary).setUint16(4, 1, true);
    assert.throws(() => decodeSnapshot(binary), /update_required/);
});
test('snapshot timeline: simulation time drives interpolation, not irregular arrival spacing; bounded, ordered, reset-safe', () => {
    const buffer = new SnapshotBuffer(), out = state();
    for (let tick = 0; tick < 600; tick += 6) {
        const s = state();
        s[L.CARS] = tick;
        s[L.CARS + 12] = 120;
        buffer.add({ tick, epoch: 1 }, s, tick * 1000 / 120 + (tick % 12 ? 17 : 0));
    }
    assert.equal(buffer.samples.length, 48);
    assert(buffer.delayMs >= 100 && buffer.delayMs <= 200);
    const last = buffer.samples.at(-1);
    buffer.add({ tick: last.tick - 6, epoch: 1 }, state(), last.arrival);
    assert.equal(buffer.samples.length, 48);
    assert.equal(buffer.rejected, 1);
    buffer.render(last.arrival, out);
    const first = buffer.playhead;
    buffer.render(last.arrival + 17, out);
    assert(buffer.playhead >= first);
    assert(out.every(Number.isFinite));
    buffer.add({ tick: 1, epoch: 2 }, state(), last.arrival + 30);
    assert.equal(buffer.samples.length, 1);
    buffer.clear();
    assert.equal(buffer.samples.length, 0);
});
test('render-only position/quaternion correction decays independently of render FPS and never mutates physics', () => {
    const before = state(), after = state();
    after[L.CARS] = 20;
    const original = after.slice(), results = [];
    for (const fps of [30, 60, 144]) {
        const visual = new VisualCorrection(L.CARS);
        visual.rebase(before, after);
        for (let i = 0; i < fps; i++) {
            const rendered = after.slice();
            visual.apply(rendered, 1 / fps);
        }
        results.push(Math.hypot(...visual.position));
    }
    assert(results.every(v => v < .002));
    assert.deepEqual(after, original);
    writeQuaternion(after, L.CARS, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    const out = after.slice();
    interpolateBody(out, before, after, L.CARS, .5, 1 / 20);
    assert(Math.abs(Math.hypot(...quaternion(out, L.CARS)) - 1) < 1e-6);
    const f = out.subarray(L.CARS + 3, L.CARS + 6), right = out.subarray(L.CARS + 6, L.CARS + 9);
    assert(Math.abs(f.reduce((sum, v, i) => sum + v * right[i], 0)) < 1e-6);
});
for (const fps of [30, 60, 144])
    test(`native 80ms / ${fps} FPS: fixed command rate, smooth local rendering and bounded replay`, async () => {
        const r = await scenario(Prediction, { fps, seconds: 6, streamFactory });
        assert(r.inputs >= 345 && r.inputs <= 365, `inputs=${r.inputs}`);
        assert.equal(r.serverTicks, 720);
        assert(r.frameResidualP95 < 10, JSON.stringify(r.diagnostics));
        assert(r.queuedMax <= 60 && r.replayMax <= 120);
        assert.equal(r.diagnostics.droppedTicks, 0);
        assert(r.diagnostics.skippedRestores > 10, 'matching ACK history must not reset hidden jump state repeatedly');
    });
test('native 80ms jitter: two-sided ball/car contact remains server-simulated', async () => {
    const r = await scenario(Prediction, { jitter: 20, setup: contactFixture, input: charge, opponents: charge, streamFactory });
    assert(r.observations.ballContacts > 0);
    assert(r.observations.ballSpeed > 500);
    assert(r.frameResidualP95 < 10);
    assert.equal(r.diagnostics.hardSnaps, 0);
});
test('native 150ms jitter: six moving cars remain bounded through contacts', async () => {
    const r = await scenario(Prediction, { rtt: 150, jitter: 25, size: 3, setup: contactFixture, opponents: opponent, streamFactory });
    assert(r.observations.ballContacts > 0);
    assert(r.queuedMax <= 60 && r.replayMax <= 120);
    assert(r.frameResidualP95 < 15);
    assert.equal(r.diagnostics.hardSnaps, 0);
});
test('native jumping/boost/aerial/flip inputs are preserved, not replaced by car-position lerping', async () => {
    const r = await scenario(Prediction, { input: aerial, streamFactory });
    assert(r.observations.maxHeight > 200);
    assert(r.observations.flips > 0);
    assert(r.frameResidualP95 < 10);
});
test('native one-second stall: resynchronizes without a lasting stale-input backlog or unbounded buffers', async () => {
    const r = await scenario(Prediction, { stall: true, stallDuration: 1000, streamFactory });
    assert.equal(r.diagnostics.resynchronizations, 1);
    assert(!r.diagnostics.predictionPaused);
    assert(r.serverInput.rebases > 0);
    assert(r.diagnostics.inputQueueTicks < 6);
    assert(r.frameResidualMax < 500, 'large outage correction is bounded, not claimed invisible');
    assert(r.queuedMax <= 60 && r.replayMax <= 120);
});

// Store the complete comparison, including the worse p95 during a full outage.
// This is not a claim that every networking condition improves on every metric.
test('reproducible before/after native comparison and evidence report', async () => {
    const { compareNetcode } = await import('../netcode/benchmark.mjs');
    const report = await compareNetcode();
    for (const { name, before, after } of report.results.filter(r => !r.name.includes('outage'))) {
        assert(after.frameResidualP95 < before.frameResidualP95 * .5, `${name}: presentation regression`);
    }
    const outage = report.results.find(r => r.name === 'one-second-outage');
    assert(outage.after.frameResidualMax < outage.before.frameResidualMax);
});
