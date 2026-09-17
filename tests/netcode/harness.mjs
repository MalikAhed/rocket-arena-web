// Virtual-time network harness: independent copies of the shipped native WASM.
// Synthetic inputs, not humans or an Internet/Chromebook capacity benchmark.
import { NativeArena } from '../../server/native.mjs';
import { controlsArray, encodeSnapshot, decodeSnapshot, NEUTRAL, SIM_HZ, SNAPSHOT_HZ } from '../../src/online/protocol.js';
import { STATE_LAYOUT as L, CAR_STATE as C, CAR_STATE_STRIDE as S } from '../../src/physics/state-layout.js';
import { placeCars, drive } from './fixtures.mjs';
const distance = (a, b, at = L.CARS) => Math.hypot(...[0, 1, 2].map(i => a[at + i] - b[at + i]));
export function percentile(values, p) { if (!values.length)
    return 0; return [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]; }
function rng(seed) { return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }; }
export async function scenario(Predictor, { name = 'drive', fps = 60, rtt = 80, jitter = 0, seconds = 12, size = 1, seed = 1717, streamFactory, input, stall = false, stallDuration = 150, downLoss = 0, opponents, setup } = {}) {
    const roster = Array.from({ length: size * 2 }, (_, i) => ({ team: i % 2, visual: 'fennec' }));
    const server = await NativeArena.create(roster), local = await NativeArena.create(roster), random = rng(seed);
    (setup ?? placeCars)(server);
    (setup ?? placeCars)(local);
    const sim = { module: local.module, get state() { return local.state; }, setControls(i, c) { local.input(i, controlsArray(c)); }, step(t) { local.module._physics_step(t); } };
    const prediction = new Predictor(sim, Array.from({ length: roster.length }, (_, i) => i));
    const clock = { prevState: local.state.slice(), currState: local.state.slice(), alpha: 0 };
    const match = { mode: 'match', phase: 'playing', overtime: false, winner: null, scorer: null, blueScore: 0, orangeScore: 0, remainingSeconds: 300, overtimeSeconds: 0, countdown: 0 };
    const up = [], down = [], jumps = [], impulses = [], errors = [], deviations = [], frameGaps = [], trace = [];
    const stream = streamFactory?.();
    const remoteStreams = Array.from({ length: roster.length - 1 }, () => streamFactory?.());
    let nextRemote = 0, remoteSeq = 0;
    const observations = { maxHeight: 0, ballContacts: 0, worldContacts: 0, flips: 0, ballSpeed: 0 };
    let now = 0, nextFrame = 0, nextTick = 1000 / SIM_HZ, tick = 0, seq = 0, controls = [...NEUTRAL], lastInput = -Infinity, upLast = 0, downLast = 0, lastFrame = null, lastVisual = null, lastVelocity = null, queuedMax = 0, replayMax = 0, steps = 0, inputs = 0;
    function delivery(last) { return Math.max(last, now + rtt / 2 + (random() * 2 - 1) * jitter); }
    function send(sequence, values, metadata) { const packet = typeof sequence === 'object' ? sequence : { seq: sequence, controls: [...values], ...metadata }; upLast = delivery(upLast); if (stall && now >= 4000 && now < 4000 + stallDuration)
        upLast = Math.max(upLast, 4000 + stallDuration + rtt / 2); up.push({ at: upLast, packet }); inputs++; return true; }
    function snapshot() { if (random() < downLoss)
        return; downLast = delivery(downLast); if (stall && now >= 4000 && now < 4000 + stallDuration)
        downLast = Math.max(downLast, 4000 + stallDuration + rtt / 2); let meta = stream?.metadata?.(); const snap = decodeSnapshot(encodeSnapshot({ tick, epoch: 1, time: now, state: server.state, match, acknowledgements: Array(roster.length).fill(0).map((_, i) => i === 0 ? (meta?.seq ?? seq) : 0), inputStates: meta ? [meta, ...remoteStreams.map(s => s.metadata())] : undefined })); down.push({ at: downLast, snap }); }
    snapshot();
    const getControls = input ?? drive;
    try {
        while (now < seconds * 1000 - 1e-6) {
            now = Math.min(nextTick, nextFrame, opponents ? nextRemote : Infinity, up[0]?.at ?? Infinity, down[0]?.at ?? Infinity);
            if (opponents && nextRemote <= now + 1e-6) {
                remoteSeq++;
                for (let slot = 1; slot < roster.length; slot++) {
                    const values = opponents(now, slot);
                    if (remoteStreams[slot - 1])
                        remoteStreams[slot - 1].push(remoteSeq, values, now);
                    else
                        server.input(slot, values);
                }
                nextRemote += 1000 / 60;
            }
            while (up.length && up[0].at <= now + 1e-6) {
                const { packet } = up.shift();
                if (stream) {
                    stream.push(packet.seq, packet.controls, now);
                }
                else {
                    seq = packet.seq;
                    controls = packet.controls;
                    lastInput = now;
                }
            }
            if (nextTick <= now + 1e-6) {
                tick++;
                if (stream) {
                    server.input(0, stream.step(now));
                }
                else
                    server.input(0, now - lastInput < 250 ? controls : NEUTRAL);
                for (let slot = 1; slot < roster.length; slot++)
                    if (remoteStreams[slot - 1])
                        server.input(slot, remoteStreams[slot - 1].step(now));
                server.step();
                steps++;
                observations.maxHeight = Math.max(observations.maxHeight, server.state[L.CARS + 2]);
                observations.ballContacts = Math.max(observations.ballContacts, server.state[L.CARS + C.BALL_HIT_SERIAL]);
                observations.worldContacts = Math.max(observations.worldContacts, server.state[L.CARS + C.WHEEL_IMPACT_SERIAL]);
                observations.flips = Math.max(observations.flips, server.state[L.CARS + C.DODGE_SERIAL]);
                observations.ballSpeed = Math.max(observations.ballSpeed, Math.hypot(...server.state.subarray(L.BALL + 12, L.BALL + 15)));
                nextTick += 1000 / SIM_HZ;
                if (tick % (SIM_HZ / SNAPSHOT_HZ) === 0)
                    snapshot();
            }
            while (down.length && down[0].at <= now + 1e-6) {
                const { snap } = down.shift();
                const before = sim.state.slice();
                prediction.receive(snap, 0, now);
                if (now > 1000) {
                    jumps.push(distance(before, sim.state));
                    errors.push(prediction.error ?? 0);
                }
            }
            if (nextFrame <= now + 1e-6) {
                prediction.update(now, getControls(now), send, clock, true);
                if (!sim.state.every(Number.isFinite))
                    throw Error('Non-finite predicted physics');
                const v = new Float32Array(clock.currState.length);
                for (let i = 0; i < v.length; i++)
                    v[i] = clock.prevState[i] + (clock.currState[i] - clock.prevState[i]) * clock.alpha;
                if (now > 1000 && lastVisual) {
                    const dt = (now - lastFrame) / 1000;
                    const displacement = [0, 1, 2].map(i => v[L.CARS + i] - lastVisual[L.CARS + i]);
                    const expected = [0, 1, 2].map(i => lastVelocity[i] * dt);
                    impulses.push(Math.hypot(...displacement.map((x, i) => x - expected[i])));
                    frameGaps.push((now - lastFrame));
                }
                if (now > 1000) {
                    deviations.push(distance(v, sim.state));
                    if (trace.length < 1000)
                        trace.push({ ms: +now.toFixed(1), pos: [...v.slice(L.CARS, L.CARS + 3)], raw: [...sim.state.slice(L.CARS, L.CARS + 3)], ball: [...v.slice(L.BALL, L.BALL + 3)] });
                }
                lastVisual = v;
                lastFrame = now;
                lastVelocity = [...sim.state.slice(L.CARS + 12, L.CARS + 15)];
                nextFrame += 1000 / fps;
                queuedMax = Math.max(queuedMax, prediction.pending?.length ?? 0);
                replayMax = Math.max(replayMax, prediction.replayTicks ?? 0);
            }
        }
        return { name, fps, rtt, jitter, seconds, size, stall, stallDuration, downLoss, observations, inputs, serverTicks: steps, corrections: prediction.corrections, synchronousReceiveJumpP95: percentile(jumps, .95), frameResidualP95: percentile(impulses, .95), frameResidualMax: Math.max(0, ...impulses), visualOffsetP95: percentile(deviations, .95), queuedMax, replayMax, diagnostics: prediction.metrics?.(), serverInput: stream ? { queued: stream.queue.length, rebases: stream.rebases, discarded: stream.discarded } : null, trace };
    }
    finally {
        prediction.dispose();
        server.dispose();
        local.dispose();
    }
}
