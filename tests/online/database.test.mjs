import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../../server/store.mjs';
import { Sessions } from '../../server/auth.mjs';
import { createGameServer } from '../../server/index.mjs';
import { configuration } from '../../server/config.mjs';

// Disposable PostgreSQL only. No test identity shortcut is exposed by the server.
test('PostgreSQL: atomic ratings, duplicate results, playlist isolation, recovery and authorization', { skip: !process.env.ONLINE_TEST_DATABASE_URL }, async t => {
  const options = { connectionString: process.env.ONLINE_TEST_DATABASE_URL, serverId: randomUUID(), season: `test-${randomUUID()}` };
  const store = new Store(options);
  await store.migrate(); await store.init();
  try {
    const players = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
      const accountId = randomUUID(); await store.profile(accountId, `Fixture ${i + 1}`);
      return { id: `u:${accountId}`, accountId, name: `Fixture ${i + 1}`, visual: 'fennec', team: i % 2, isTest: false };
    }));
    const reserve = async (size = 1, extras = {}) => {
      const room = { id: randomUUID(), size, mode: 'ranked', region: 'ci-only', private: false, players: players.slice(0, size * 2), ...extras };
      await store.reserve(room); await store.activate(room.id); return room;
    };
    const outcome = (room, extra = {}) => ({ matchId: room.id, winner: 0, blueScore: 1, orangeScore: 0, reason: 'test_fixture', abandoned: [], ...extra });
    await t.test('concurrent retry awards exactly once and preserves the original result', async () => {
      const room = await reserve();
      const results = await Promise.all(Array.from({ length: 8 }, () => store.finalize(room.id, outcome(room))));
      results.forEach(result => assert.deepEqual(result, results[0]));
      assert.equal(results[0].changes.length, 2);
      assert.equal((await store.ratingFor(players[0].accountId, 1, 'ranked')).games, 1);
      assert.equal((await store.ratingFor(players[0].accountId, 2, 'ranked')).games, 0);
      assert.equal((await store.ratingFor(players[0].accountId, 1, 'casual')).games, 0);
      assert.equal((await store.history(players[0].accountId)).length, 1);
      assert.equal((await store.finalize(room.id, outcome(room, { winner: 1 }))).winner, 0);
    });
    await t.test('team playlists persist independently and concurrent matches do not lose updates', async () => {
      const rooms = [await reserve(2), await reserve(2), await reserve(3)];
      await Promise.all(rooms.map(room => store.finalize(room.id, outcome(room))));
      const profile = await store.getProfile(players[0].accountId);
      assert.deepEqual(profile.progress.map(p => p.games), [1, 2, 1]);
      assert.equal(profile.progress[1].rank.id, 'unranked');
    });
    await t.test('invalid abandonment is rejected before journalling; a corrected result applies once', async () => {
      const room = await reserve(), before = await store.ratingFor(players[0].accountId, 1, 'ranked');
      // Malformed server outcomes must not poison the durable replay queue.
      const duplicate = { id: players[1].id, reason: 'left_match' };
      await assert.rejects(store.finalize(room.id, outcome(room, { abandoned: [duplicate, duplicate] })));
      assert.deepEqual(await store.ratingFor(players[0].accountId, 1, 'ranked'), before);
      assert.equal((await store.pool.query('SELECT count(*)::integer AS n FROM arena.rating_history WHERE match_id=$1', [room.id])).rows[0].n, 0);
      const result = await store.finalize(room.id, outcome(room, { abandoned: [duplicate] }));
      assert.equal(result.status, 'completed');
      await assert.rejects(store.checkCooldown(players[1].accountId), error => error.code === 'cooldown');
      assert.equal((await store.pool.query('SELECT count(*)::integer AS n FROM arena.abandonments WHERE match_id=$1', [room.id])).rows[0].n, 1);
    });
    await t.test('durable outbox survives a failed rating transaction and preserves the first winner', async () => {
      const room = await reserve(1, { players: players.slice(2, 4) });
      const before = await store.ratingFor(players[2].accountId, 1, 'ranked');
      // A real PostgreSQL constraint injects a failure after a rating UPDATE,
      // not a mock response. The disposable CI database contains no real users.
      await store.pool.query(`ALTER TABLE arena.rating_history ADD CONSTRAINT injected_result_failure CHECK (match_id <> '${room.id}'::uuid)`);
      try {
        await assert.rejects(store.finalize(room.id, outcome(room)));
        assert.deepEqual(await store.ratingFor(players[2].accountId, 1, 'ranked'), before);
        assert.equal((await store.pool.query('SELECT count(*)::integer AS n FROM arena.rating_history WHERE match_id=$1', [room.id])).rows[0].n, 0);
        const pending = (await store.pool.query('SELECT outcome FROM arena.pending_results WHERE match_id=$1', [room.id])).rows[0];
        assert.equal(pending.outcome.winner, 0);
      } finally { await store.pool.query('ALTER TABLE arena.rating_history DROP CONSTRAINT injected_result_failure'); }
      const result = await store.finalize(room.id, outcome(room, { winner: 1 }));
      assert.equal(result.winner, 0, 'retry cannot replace the first durable authoritative outcome');
      assert.equal((await store.ratingFor(players[2].accountId, 1, 'ranked')).games, before.games + 1);
      assert.equal((await store.pool.query('SELECT count(*)::integer AS n FROM arena.pending_results WHERE match_id=$1', [room.id])).rows[0].n, 0);
    });
    await t.test('cancellation cannot erase an already journalled completed outcome', async () => {
      const room = await reserve(1, { players: players.slice(2, 4) });
      await store.queueResult(room.id, outcome(room));
      assert.equal((await store.cancel(room.id, 'server_restart')).status, 'completed');
      assert.equal((await store.finalize(room.id)).winner, 0);
    });
    await t.test('private rooms, test clients and guests cannot earn Ranked MMR', async () => {
      for (const extra of [{ private: true }, { players: players.slice(0, 2).map(p => ({ ...p, isTest: true })) },
        { players: players.slice(0, 2).map((p, i) => i ? p : { ...p, id: `g:${randomUUID()}`, accountId: null }) }]) {
        const room = await reserve(1, extra);
        await assert.rejects(store.finalize(room.id, outcome(room)), /eligibility/);
        await store.cancel(room.id, 'ineligible_test_fixture');
      }
    });
    await t.test('cancelled/infrastructure matches do not change ratings', async () => {
      const room = await reserve(), before = await store.ratingFor(players[0].accountId, 1, 'ranked');
      await store.cancel(room.id, 'server_restart');
      assert.equal((await store.finalize(room.id, outcome(room))).status, 'cancelled');
      assert.deepEqual(await store.ratingFor(players[0].accountId, 1, 'ranked'), before);
    });
    await t.test('server verifies provider identity, rejects anonymous users, and retains accounts', async () => {
      const fixture = players[4], accessToken = 'in-process-fixture-only-not-a-real-token';
      let calls = 0, bad = false;
      const sessions = new Sessions({ store, supabaseUrl: 'https://fixture.supabase.co', publicKey: 'fixture-publishable-key',
        fetchImpl: async (url, options) => { calls++; assert.equal(options.headers.Authorization, `Bearer ${accessToken}`);
          return new Response(JSON.stringify({ id: fixture.accountId, is_anonymous: bad }), { status: 200 }); } });
      const issued = await sessions.create({ name: 'New name', accessToken });
      assert.equal(issued.player.id, fixture.id); assert.equal(issued.player.name, fixture.name);
      await sessions.requireRanked(sessions.get(issued.token)); assert.equal(calls, 2);
      bad = true; await assert.rejects(sessions.requireRanked(sessions.get(issued.token)), error => error.code === 'sign_in_required');
      assert.equal(sessions.get('invalid'), null);
    });
    await t.test('lease excludes a second server; interrupted matches become no-contest on restart', async () => {
      const second = new Store({ ...options, serverId: randomUUID() });
      try { await assert.rejects(second.init(), /lease/); } finally { await second.close(); }
      const room = await reserve();
      const queued = await reserve(1, { players: players.slice(4, 6) });
      await store.queueResult(queued.id, outcome(queued));
      const app = await createGameServer(configuration({ PORT: '0', DATABASE_URL: options.connectionString, SEASON_ID: options.season }));
      try {
        const origin = `http://127.0.0.1:${app.port}`;
        assert.equal((await fetch(origin + '/healthz')).status, 200);
        assert.equal((await fetch(origin + '/readyz')).status, 503);
        assert.equal((await (await fetch(origin + '/healthz')).json()).status, 'warming');
        const admission = await fetch(origin + '/session', { method: 'POST', headers: {Origin: 'http://127.0.0.1:4173', 'Content-Type': 'application/json'}, body: JSON.stringify({name:'Waiting Player'}) });
        assert.equal(admission.status, 503);
        await store.close();
        assert.equal(await app.initialization, true);
        assert.equal((await fetch(origin + '/readyz')).status, 200);
        assert.equal((await app.store.pool.query('SELECT status FROM arena.matches WHERE id=$1', [room.id])).rows[0].status, 'cancelled');
        assert.equal((await app.store.getProfile(players[0].accountId)).progress[0].games, 2);
        assert.equal((await app.store.getProfile(players[4].accountId)).progress[0].games, 1);
        assert.equal(app.store.recoveredResults, 1);
        const recovered = (await app.store.pool.query('SELECT result FROM arena.matches WHERE id=$1', [queued.id])).rows[0].result;
        assert.equal(recovered.status, 'completed'); assert.equal(recovered.winner, 0);
        assert.equal((await app.store.pool.query('SELECT count(*)::integer AS n FROM arena.pending_results')).rows[0].n, 0);
      } finally { await app.close(); }
    });
  } finally { if (!store.pool.ended) await store.close(); }
});
