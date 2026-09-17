import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from '../../src/online/snapshot-buffer.js';
import { TimingWindow } from '../../src/online/timing.js';
import { Prediction } from '../../src/online/prediction.js';
import { InputStream } from '../../server/input-stream.mjs';
import { Room } from '../../server/room.mjs';
import { NativeArena } from '../../server/native.mjs';
import { STATE_LAYOUT as L } from '../../src/physics/state-layout.js';
import { STATE_SIZE, encodeSnapshot, decodeSnapshot, controlsArray } from '../../src/online/protocol.js';
import { scenario } from '../netcode/harness.mjs';
import { opponent } from '../netcode/fixtures.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const streamFactory = () => new InputStream();
function frame(tick) { const state=new Float32Array(STATE_SIZE); state[L.NUM_CARS]=2; state[L.NUM_PADS]=34; state[L.CARS]=tick; return state; }

test('suspension recovery: remote playback does not stay seconds behind or accept stale epochs', () => {
  const buffer = new SnapshotBuffer(), out=frame(0);
  for (let tick=0; tick<=120; tick+=6) { buffer.add({tick,epoch:1},frame(tick),tick*1000/120); buffer.render(tick*1000/120,out); }
  const prior=buffer.playhead;
  // Rendering suspends for three seconds while networking continues.
  for (let tick=126; tick<=480; tick+=6) buffer.add({tick,epoch:1},frame(tick),tick*1000/120);
  buffer.render(4000,out);
  assert(buffer.playhead >= 3850, `old playhead ${prior}, resumed ${buffer.playhead}`);
  assert(buffer.ageMs <= 150); assert.equal(buffer.rebases,1);
  buffer.add({tick:1,epoch:0},frame(1),4010);
  assert.equal(buffer.epoch,1); assert.equal(buffer.rejected,1);
});

test('snapshot parser rejects invalid clock/winner metadata rather than rendering NaNs', () => {
  const match={phase:'playing',overtime:false,winner:null,scorer:null,blueScore:0,orangeScore:0,remainingSeconds:300,overtimeSeconds:0,countdown:0};
  for (const at of [24,28,32]) {
    const data=encodeSnapshot({tick:1,state:frame(1),match,acknowledgements:[0,0]}); new DataView(data).setFloat32(at,NaN,true);
    assert.throws(()=>decodeSnapshot(data), /invalid_snapshot/);
  }
});

test('timing windows remain bounded and report stutters instead of hiding them', () => {
  const timing=new TimingWindow(10);
  for(let i=0;i<1000;i++) timing.add(16);
  timing.add(250); timing.add(NaN); timing.add(-1);
  assert.equal(timing.values.length,10); assert.equal(timing.summary().total,1001);
  assert.equal(timing.summary().p95Ms,250); assert.equal(timing.summary().p50Ms,16);
});

test('server catch-up preserves every physics tick but emits only the newest scheduled snapshot', async () => {
  const players=[0,1].map(team=>({id:`fixture:${team}`,team,visual:'fennec'}));
  const sent=[];
  const room=new Room({players,size:1,mode:'casual',region:'test',peerFor:()=>({send(){},sendBinary:b=>sent.push(decodeSnapshot(b))}),onDispose(){}});
  room.arena=await NativeArena.create(players); room.active=true; room.match.state.phase='playing';
  try {
    for(let i=0;i<24;i++) room.step(i*1000/120,true);
    assert.equal(room.tick,24); assert.equal(sent.length,0);
    room.flushSnapshot(); assert.equal(sent.length,2); assert(sent.every(s=>s.tick===24));
    room.flushSnapshot(); assert.equal(sent.length,2);
  } finally { room.arena.dispose(); }
});

test('two-minute six-car native soak: bounded reusable state storage and replay with variable inputs', {timeout:45000}, async () => {
  let pooled;
  class Audited extends Prediction {
    constructor(...args) { super(...args); pooled=new Set(this.packetPool.flatMap(p=>p.states)); }
    update(...args) { super.update(...args);
      assert(this.pending.every(p=>p.states.every(s=>pooled.has(s))));
      assert.equal(new Set(this.pending).size,this.pending.length,'history buffers cannot alias live commands');
    }
  }
  const r=await scenario(Audited,{name:'120-second-6car-soak',seconds:120,size:3,rtt:80,jitter:20,opponents:opponent,input:t=>opponent(t,0),streamFactory});
  assert.equal(r.serverTicks,14400); assert(r.queuedMax<=60 && r.replayMax<=120);
  assert.equal(r.diagnostics.historyBytes,248880); assert(r.serverInput.queued <= 32);
  delete r.trace;
  await mkdir('evidence/netcode',{recursive:true}); await writeFile('evidence/netcode/long-session.json',JSON.stringify(r,null,2));
});

test('GPU-limited rendering does not halve input/simulation rate; telemetry still reports the slow frames', async () => {
  const r=await scenario(Prediction,{name:'gpu-blocked-5fps',fps:5,maintenanceHz:120,seconds:6,streamFactory});
  assert(r.inputs>=345 && r.inputs<=365,`commands=${r.inputs}`);
  assert(r.diagnostics.simulatedTicks > 700);
  assert(r.diagnostics.frameTiming.p95Ms >= 190,'must not mislabel maintenance as rendered frames');
  assert.equal(r.diagnostics.droppedTicks,0);
});

test('approved production Pages origin is exact, never a wildcard GitHub origin', async()=>{
  const {configuration}=await import('../../server/config.mjs');
  const config=configuration({NODE_ENV:'production',ALLOWED_ORIGINS:'https://rocket-arena-online-preview.onrender.com'});
  assert(config.origins.includes('https://malikahed.github.io'));
  assert(!config.origins.includes('https://attacker.github.io'));
  assert(!config.origins.includes('*'));
});
