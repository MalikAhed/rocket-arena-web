import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameScheduler } from '../../src/rendering/frame-scheduler.js';

test('GPU fences throttle rendering but allow explicitly registered maintenance',()=>{
  const old={document:globalThis.document,MessageChannel:globalThis.MessageChannel};
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  globalThis.MessageChannel=class {constructor(){this.port1={close(){}};this.port2={close(){},postMessage(){}};}};
  const gl={TIMEOUT_EXPIRED:1,clientWaitSync:()=>1,isContextLost:()=>false,deleteSync(){},canvas:{addEventListener(){},removeEventListener(){}}};
  let draws=0,pumps=0;
  const scheduler=new FrameScheduler(gl,()=>draws++,()=>{},()=>pumps++);
  try {
    scheduler.schedule=()=>{}; scheduler.running=true; scheduler.lastMaintenance=-1000;
    scheduler.pending.push({},{}); scheduler.tick();
    assert.equal(draws,0);assert.equal(pumps,1);assert.equal(scheduler.pending.length,2);
    scheduler.tick(); assert.equal(pumps,1,'maintenance itself is rate-bounded');
    globalThis.document.hidden=true;scheduler.lastMaintenance=-1000;scheduler.tick();assert.equal(pumps,1,'hidden tab must not keep controlling its car');
  } finally {scheduler.dispose(); Object.assign(globalThis,old);}
});
