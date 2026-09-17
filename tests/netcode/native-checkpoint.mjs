import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import oldFactory from '../../public/physics/rocketsim-core.js';
import newFactory from '../../public/physics/rocketsim-network.js';
import { PHYSICS_PRESETS } from '../../src/physics/presets.js';
import { addConfiguredCar } from '../../src/physics/car-config.js';
import { STATE_LAYOUT as L, CAR_STATE as C, CAR_STATE_STRIDE as S } from '../../src/physics/state-layout.js';
const report={synthetic:true,scope:'Native gameplay checkpoint and unchanged offline algorithms; not WAN or full Bullet rollback',checks:[],cases:[]};
async function fixture(network=true,size=2,order=Array.from({length:size},(_,i)=>i)){
 const binary=await readFile(new URL(`../../public/physics/rocketsim-${network?'network':'core'}.wasm`,import.meta.url));
 const m=await (network?newFactory:oldFactory)({wasmBinary:binary,print(){},printErr(){}});
 const dir=new URL('../../public/assets/arena/collision/',import.meta.url);
 const names=JSON.parse(await readFile(new URL('manifest.json',dir),'utf8'));
 const meshes=await Promise.all(names.map(n=>readFile(new URL(n,dir))));
 const data=m._malloc(meshes.reduce((s,b)=>s+b.length,0)),lengths=m._malloc(meshes.length*4);
 let at=data;meshes.forEach((b,i)=>{m.HEAPU8.set(b,at);m.HEAP32[lengths/4+i]=b.length;at+=b.length;});
 assert.equal(m._physics_init(data,lengths,meshes.length),1);m._free(data);m._free(lengths);assert.equal(m._physics_createArena(),1);
 m._experimentalAddConfiguredCar=m._physics_addConfiguredCar;
 for(let i=0;i<size;i++)assert.equal(addConfiguredCar(m,order[i]%2,PHYSICS_PRESETS.octane),i);
 m._physics_resetKickoff(7);m._physics_setUnlimitedBoost(0);m._physics_setGoalExplosionEnabled(0);
 const statePtr=m._physics_getStatePtr(),inputPtr=m._physics_getControlsPtr();
 const scratch=m._malloc((510+1000+8)*4), mapPtr=scratch+(510+1000)*4;
 return {m,size,order,scratch,
  get state(){return new Float32Array(m.HEAPF32.buffer,statePtr,510);},
  input(i,controls){m.HEAPF32.set(controls,inputPtr/4+i*8);},step(n=1){m._physics_step(n);},
  capture(){const p=m._physics_captureNetState();assert(p);return new Float32Array(m.HEAPF32.buffer,p,m._physics_getNetStateSize()).slice();},
  restore(base,checkpoint,mapping=order){m.HEAPF32.set(base,scratch/4);m.HEAPF32.set(checkpoint,scratch/4+510);m.HEAP32.set(mapping,mapPtr/4);return m._physics_restoreNetState(scratch,scratch+510*4,checkpoint.length,mapPtr);},
  partial(base){
   m.HEAPF32.set(base.subarray(L.BALL,L.BALL+18),scratch/4);m._physics_setBallState(scratch);
   for(let i=0;i<size;i++){const p=L.CARS+i*S;m.HEAPF32.fill(0,scratch/4,scratch/4+24);m.HEAPF32.set(base.subarray(p,p+19),scratch/4);
    m.HEAPF32[scratch/4+19]=base[p+C.ON_GROUND];m.HEAPF32[scratch/4+20]=+(base[p+C.ON_GROUND]!==1);m.HEAPF32[scratch/4+21]=+(base[p+C.HAS_FLIP_OR_JUMP]!==1);m.HEAPF32[scratch/4+22]=base[p+C.IS_FLIPPING];
    assert.equal(m._physics_setCarState(i,scratch),1);
   }m._physics_step(0);
  },
  close(){m._free(scratch);m._physics_destroy();}
 };
}
const command=t=>[1,t>360&&t<540?.3:0,t>720&&t<850?-.4:0,0,0,+(t>=180&&t<204||t>=225&&t<230),+(t<120||t>=700&&t<820),+(t>400&&t<450)];
const error=(a,b,at=L.CARS)=>Math.hypot(a[at]-b[at],a[at+1]-b[at+1],a[at+2]-b[at+2]);
for(const size of [2,4,6])test(`native addon ${size} cars: original movement output is unchanged without restoring`,async()=>{
 const a=await fixture(false,size),b=await fixture(true,size);
 try{for(let t=0;t<1000;t++){
  for(let i=0;i<size;i++){const c=command(t+i*7);a.input(i,c);b.input(i,c);}a.step();b.step();
  assert.deepEqual(b.state,a.state,`native baseline divergence at tick ${t}`);
  if(t%6===0){const before=b.state.slice();b.capture();assert.deepEqual(b.state,before);}
 }report.checks.push(`${size}-car 1000-tick original/new state equality`);}finally{a.close();b.close();}
});

test('native checkpoint preserves mid-jump hidden state and prevents the pose-only restart of jump progression',async()=>{
 const server=await fixture(),restored=await fixture(),partial=await fixture();
 try{
  for(let t=0;t<190;t++){server.input(0,command(t));server.step();}
  const base=server.state.slice(),checkpoint=server.capture();
  assert.equal(checkpoint[24+4],1);assert.equal(checkpoint[24+7],1);
  assert.equal(restored.restore(base,checkpoint),1);partial.partial(base);
  assert.deepEqual(restored.capture(),checkpoint,'full exposed gameplay fields must roundtrip');
  assert.deepEqual(restored.state,base,'published pose/flags/events must roundtrip');
  let maximum=0,legacyMaximum=0;
  for(let t=190;t<250;t++){for(const f of [server,restored,partial]){f.input(0,command(t));f.step();}
   maximum=Math.max(maximum,error(server.state,restored.state));legacyMaximum=Math.max(legacyMaximum,error(server.state,partial.state));
  }
  report.cases.push({name:'mid-jump-to-double-jump',checkpointMaxPositionError:maximum,poseOnlyMaxPositionError:legacyMaximum});
  assert(maximum<2,`gameplay restore drift ${maximum}`);assert(legacyMaximum>maximum+5,`legacy=${legacyMaximum} checkpoint=${maximum}`);
 }finally{server.close();restored.close();partial.close();}
});

test('native checkpoint is atomic for malformed state and correctly maps nonzero local player slots',async()=>{
 const server=await fixture(),client=await fixture(true,2,[1,0]);
 try{
  for(let t=0;t<210;t++){server.input(0,command(t));server.step();}
  const base=server.state.slice(),checkpoint=server.capture();
  assert.equal(client.restore(base,checkpoint),1);
  assert.deepEqual(client.state.slice(L.CARS,L.CARS+S),base.slice(L.CARS+S,L.CARS+2*S));
  assert.deepEqual(client.state.slice(L.CARS+S,L.CARS+2*S),base.slice(L.CARS,L.CARS+S));
  const before=client.state.slice(), hidden=client.capture();
  for(const change of [c=>c[0]=0,c=>c[24+8]=NaN,c=>c[24+31]=7]){const bad=checkpoint.slice();change(bad);assert.equal(client.restore(base,bad),0);assert.deepEqual(client.state,before);assert.deepEqual(client.capture(),hidden);}
  assert.equal(client.restore(base,checkpoint,[0,0]),0);assert.deepEqual(client.state,before);
  assert.equal(client.restore(base,checkpoint.subarray(0,checkpoint.length-1)),0);
  report.checks.push('Atomic validation and reversed player-slot restoration');
 }finally{server.close();client.close();}
});

test('checkpoint restores collected boost pads and their lock owner rather than fabricating a second pickup',async()=>{
 const a=await fixture(),b=await fixture();
 try{
  const ptr=a.m._physics_getPadInfoPtr(),pad=new Float32Array(a.m.HEAPF32.buffer,ptr,4);
  const p=[pad[0],pad[1],17,1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0];
  a.m.HEAPF32.set(p,a.scratch/4);assert.equal(a.m._physics_setCarState(0,a.scratch),1);a.step();
  const snapshot=a.capture(),padAt=24+2*80;assert(snapshot[padAt+1]>0,'fixture must collect a real native boost pad');
  assert.equal(b.restore(a.state.slice(),snapshot),1);assert.deepEqual(b.capture(),snapshot);
  assert.equal(b.state[L.CARS+C.BOOST],a.state[L.CARS+C.BOOST]);
  report.checks.push('Native boost pickup/cooldown/lock checkpoint roundtrip');
 }finally{a.close();b.close();}
});

test.after(async()=>{await mkdir('evidence/native-checkpoint',{recursive:true});await writeFile('evidence/native-checkpoint/report.json',JSON.stringify(report,null,2));});
