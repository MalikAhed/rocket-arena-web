import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { createGameServer } from '../../server/index.mjs';
import { configuration } from '../../server/config.mjs';
import { NativeArena } from '../../server/native.mjs';
import { Prediction } from '../../src/online/prediction.js';
import { InputStream } from '../../server/input-stream.mjs';
import { PROTOCOL, PHYSICS_SHA256, encodeSnapshot, decodeSnapshot } from '../../src/online/protocol.js';
import { CHECKPOINT_TAG, checkpointSize, hiddenStateAgrees } from '../../src/online/checkpoint.js';
import { NETWORK_CORE_SHA256 } from '../../src/physics/network-core.js';
import { scenario } from '../netcode/harness.mjs';
import { aerial, charge, contactFixture, opponent } from '../netcode/fixtures.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import '../netcode/native-checkpoint.mjs';
const origin='http://127.0.0.1:4173';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn) { const end=performance.now()+7000;while(!fn()){if(performance.now()>end)throw Error('Timed out');await sleep(10);}return fn(); }
const match={phase:'playing',overtime:false,winner:null,scorer:null,blueScore:0,orangeScore:0,remainingSeconds:300,overtimeSeconds:0,countdown:0};
test('checkpoint wire extension is bounded and optional; old v2 packet lengths stay valid',async()=>{
 for(const cars of [2,4,6]){
  const arena=await NativeArena.create(Array.from({length:cars},(_,i)=>({team:i%2,visual:'fennec'})));
  try{
   const base=encodeSnapshot({tick:1,state:arena.state,match,acknowledgements:Array(cars).fill(0)});
   const extended=encodeSnapshot({tick:1,state:arena.state,match,acknowledgements:Array(cars).fill(0),checkpoint:arena.checkpoint});
   assert.equal(decodeSnapshot(base).checkpoint,undefined);
   assert.equal(extended.byteLength,({2:2176,4:3304,6:4432})[cars]);
   assert.deepEqual(decodeSnapshot(extended).checkpoint,arena.checkpoint);
   assert.equal(new DataView(extended).getUint32(base.byteLength,true),CHECKPOINT_TAG);
   assert.throws(()=>decodeSnapshot(extended.slice(0,-4)),/invalid_snapshot/);
   const bad=extended.slice(0);new DataView(bad).setUint32(base.byteLength+4,0xffffffff,true);assert.throws(()=>decodeSnapshot(bad),/invalid_checkpoint/);
   new DataView(extended).setFloat32(base.byteLength+8+4*32,NaN,true);assert.throws(()=>decodeSnapshot(extended),/invalid_checkpoint/);
  }finally{arena.dispose();}
 }
});
test('matching pose is insufficient when acknowledged jump timers or controls disagree',()=>{
 const c=new Float32Array(checkpointSize(2,34)),h=new Float32Array(80);
 assert(hiddenStateAgrees(h,c,1));c[24+80+8]=.05;assert(!hiddenStateAgrees(h,c,1));
 c.fill(0);c[24+80+36]=1;assert(!hiddenStateAgrees(h,c,1));
});
test('real sockets negotiate checkpoint for one player while legacy v2 player receives the original packet', {timeout:15000},async()=>{
 const app=await createGameServer(configuration({PORT:'0',MAX_ROOMS:'1'})), clients=[];
 try{
  for(const capability of [1,0]){
   const res=await fetch(`http://127.0.0.1:${app.port}/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:`Native Player ${capability}`})});
   const session=await res.json();assert(res.ok);
   const ws=new WebSocket(`ws://127.0.0.1:${app.port}/play`,{origin}),messages=[],snapshots=[];
   ws.on('message',(data,binary)=>binary?snapshots.push(decodeSnapshot(data)):messages.push(JSON.parse(data)));
   await once(ws,'open');const send=m=>ws.send(JSON.stringify(m));
   send({type:'hello',protocol:PROTOCOL,physics:PHYSICS_SHA256,token:session.token,...(capability?{nativeCheckpoint:1}:{})});
   await until(()=>messages.find(m=>m.type==='connected'));
   clients.push({ws,messages,snapshots,send,capability});
  }
  for(const c of clients)c.send({type:'queue',mode:'casual',size:1,visual:'fennec',request:1,region:'local'});
  await until(()=>clients.every(c=>c.messages.some(m=>m.type==='reserved')&&c.snapshots.length));
  for(const c of clients){
   const reservation=c.messages.find(m=>m.type==='reserved');assert.equal(reservation.nativeCheckpoint,c.capability);
   assert.equal(reservation.nativePhysics,c.capability?NETWORK_CORE_SHA256:undefined);
   assert(c.snapshots.every(s=>!!s.checkpoint===!!c.capability));
  }
  assert.equal(clients[0].messages.find(m=>m.type==='reserved').matchId,clients[1].messages.find(m=>m.type==='reserved').matchId);
 }finally{for(const c of clients)c.ws.terminate();await app.close();}
});
test('native checkpoint prediction passes latency, ball contacts, aerials and six-car replay with a bounded history', {timeout:45000},async()=>{
 const report=[];
 for(const config of [
  {name:'aerial-80ms-jitter',input:aerial,jitter:20},
  {name:'contact-80ms-jitter',setup:contactFixture,input:charge,opponents:charge,jitter:20},
  {name:'6car-150ms-jitter',setup:contactFixture,size:3,opponents:opponent,rtt:150,jitter:25},
  {name:'120-second-6car-checkpoint-soak',seconds:120,size:3,input:t=>opponent(t,0),opponents:opponent,jitter:20},
 ]){
  const r=await scenario(Prediction,{...config,checkpoints:true,streamFactory:()=>new InputStream()});
  assert.equal(r.diagnostics.nativeCheckpoint,1);assert(r.diagnostics.checkpointRestores>0);
  assert(r.queuedMax<=60 && r.replayMax<=120);assert.equal(r.diagnostics.hardSnaps,0);
  assert(r.frameResidualP95<15,`${config.name}: ${r.frameResidualP95}`);
  if(config.setup)assert(r.observations.ballContacts>0);
  if(config.input===aerial)assert(r.observations.maxHeight>200 && r.observations.flips>0);
  delete r.trace;report.push(r);
 }
 await mkdir('evidence/native-checkpoint',{recursive:true});await writeFile('evidence/native-checkpoint/network-scenarios.json',JSON.stringify({synthetic:true,virtualTime:true,results:report},null,2));
});
