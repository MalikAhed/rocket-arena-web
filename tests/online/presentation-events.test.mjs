import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_FIELDS, copyConfirmedEvents } from '../../src/online/presentation-events.js';
import { Prediction } from '../../src/online/prediction.js';
import { InputStream } from '../../server/input-stream.mjs';
import { STATE_LAYOUT as L, CAR_STATE_STRIDE as STRIDE } from '../../src/physics/state-layout.js';
import { STATE_SIZE } from '../../src/online/protocol.js';
import { scenario } from '../netcode/harness.mjs';
import { contactFixture, charge, aerial } from '../netcode/fixtures.mjs';

test('presentation: confirmed one-shot events cannot be replaced by replay counters, including reordered slots', () => {
  const rendered = new Float32Array(STATE_SIZE), authoritative = rendered.slice();
  rendered[L.CARS] = 1234;
  for (const [index, field] of EVENT_FIELDS.entries()) {
    rendered[L.CARS + field] = 999;
    authoritative[L.CARS + STRIDE + field] = index + 3;
  }
  const preserved = authoritative.slice();
  copyConfirmedEvents(rendered, authoritative, 1);
  assert.equal(rendered[L.CARS], 1234, 'does not replace predicted movement');
  for (const [index, field] of EVENT_FIELDS.entries()) assert.equal(rendered[L.CARS + field], index + 3);
  assert.deepEqual(authoritative, preserved, 'never writes to physics');
});

test('native replay: jump, flip-reset and collision effect counters remain server-confirmed at every render', async () => {
  let checkedFrames = 0;
  class AuditedPrediction extends Prediction {
    update(now, controls, send, clock, connected) {
      super.update(now, controls, send, clock, connected);
      if (!this.latest) return;
      for (const field of EVENT_FIELDS) assert.equal(clock.currState[L.CARS + field], this.latest.state[L.CARS + this.order[0] * STRIDE + field], `field=${field}, now=${now}`);
      checkedFrames++;
    }
  }
  for (const config of [{ input: aerial }, { setup: contactFixture, input: charge, opponents: charge, jitter: 20 }]) {
    const r = await scenario(AuditedPrediction, { ...config, streamFactory: () => new InputStream() });
    assert(r.frameResidualP95 < 10);
    if (config.setup) assert(r.observations.ballContacts > 0);
    else assert(r.observations.flips > 0 && r.observations.maxHeight > 200);
  }
  assert(checkedFrames > 1000);
});
