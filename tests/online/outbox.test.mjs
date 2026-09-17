import test from 'node:test';
import assert from 'node:assert/strict';
import { stageResult, recoverPendingResults } from '../../server/result-outbox.mjs';

function fixture(extras = {}) {
  const match = { id: 'fixture-match', status: 'active', mode: 'ranked', playlist: 1, private: false, ...extras };
  const roster = [{ identity: 'u:a', player_id: 'a', team: 0 }, { identity: 'u:b', player_id: 'b', team: 1 }];
  let pending, releases = 0, failInsert = false;
  const client = {
    async query(sql, values) {
      if (sql.startsWith('SELECT * FROM arena.matches')) return { rows: [match] };
      if (sql.startsWith('SELECT * FROM arena.roster')) return { rows: roster };
      if (sql.startsWith('SELECT outcome')) return { rows: pending ? [{ outcome: pending }] : [] };
      if (sql.startsWith('INSERT')) { if (failInsert) throw Error('injected storage failure'); pending = structuredClone(values[1]); }
      if (sql.startsWith('DELETE')) pending = undefined;
      return { rows: [] };
    }, release() { releases++; },
  };
  return { pool: { connect: async () => client }, match, roster, get pending() { return pending; }, get releases() { return releases; }, fail() { failInsert = true; } };
}
const outcome = { winner: 0, blueScore: 1, orangeScore: 0, reason: 'full_time', abandoned: [] };
test('outbox: first durable outcome wins even when retries submit a different winner', async () => {
  const f = fixture();
  const first = await stageResult(f.pool, f.match.id, outcome);
  const duplicate = await stageResult(f.pool, f.match.id, { ...outcome, winner: 1 });
  assert.deepEqual(duplicate, first); assert.equal(first.outcome.winner, 0); assert.equal(f.releases, 2);
  assert.equal(first.outcome.matchId, f.match.id);
});
test('outbox: recovery uses recorded outcome without accepting new caller values', async () => {
  const f = fixture(); await stageResult(f.pool, f.match.id, outcome);
  assert.equal((await stageResult(f.pool, f.match.id)).outcome.winner, 0);
});
test('outbox: rejects invalid scores, abandonment and ineligible Ranked before durable staging', async () => {
  for (const value of [{ ...outcome, winner: 9 }, { ...outcome, blueScore: NaN }, { ...outcome, reason: '<script>' },
    { ...outcome, abandoned: [{ id: 'u:outsider', reason: 'afk' }] },
    { ...outcome, abandoned: [{ id: 'u:a', reason: 'afk' }, { id: 'u:a', reason: 'afk' }] }]) {
    const f = fixture(); await assert.rejects(stageResult(f.pool, f.match.id, value)); assert.equal(f.pending, undefined); assert.equal(f.releases, 1);
  }
  for (const extras of [{ private: true }, { status: 'reserved' }]) {
    const f = fixture(extras); await assert.rejects(stageResult(f.pool, f.match.id, outcome)); assert.equal(f.pending, undefined);
  }
  const f = fixture(); f.roster[0].is_test = true;
  await assert.rejects(stageResult(f.pool, f.match.id, outcome), /eligibility/);
});
test('outbox: cancelled matches remain no-contest; completed results are immutable', async () => {
  for (const status of ['cancelled', 'completed']) {
    const f = fixture({ status, result: { status, winner: status === 'completed' ? 1 : null } });
    assert.deepEqual((await stageResult(f.pool, f.match.id, outcome)).result, f.match.result);
    assert.equal(f.pending, undefined);
  }
});
test('outbox: failed journal writes release the client and do not claim durability', async () => {
  const f = fixture(); f.fail(); await assert.rejects(stageResult(f.pool, f.match.id, outcome), /storage failure/);
  assert.equal(f.pending, undefined); assert.equal(f.releases, 1);
});
test('outbox: startup replay drains bounded batches and propagates failures', async () => {
  const ids = ['a', 'b'], seen = [];
  const store = { pool: { query: async () => ({ rows: ids.map(match_id => ({ match_id })) }) },
    finalize: async id => { seen.push(id); ids.splice(ids.indexOf(id), 1); } };
  assert.equal(await recoverPendingResults(store), 2); assert.deepEqual(seen, ['a', 'b']);
  ids.push('c'); store.finalize = async () => { throw Error('database still unavailable'); };
  await assert.rejects(recoverPendingResults(store), /still unavailable/); assert.deepEqual(ids, ['c']);
});
