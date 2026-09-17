// A completed authoritative outcome is journalled BEFORE rating mutations.
// Only the trusted game process imports this module; there is no public API.
// If PostgreSQL is unreachable before this journal commits, a simultaneous
// process loss still cannot recover that outcome: restart is then no-contest.
function canonicalOutcome(match, roster, outcome) {
  if (match.status !== 'active' || !outcome || ![0, 1].includes(outcome.winner)) throw new Error('Ineligible match result');
  if (roster.length !== match.playlist * 2 || [0, 1].some(team => roster.filter(p => p.team === team).length !== match.playlist)) throw new Error('Incomplete match roster');
  if (match.mode === 'ranked' && (match.private || roster.some(p => p.is_test || !p.player_id))) throw new Error('Ranked eligibility rejected');
  if (![outcome.blueScore, outcome.orangeScore].every(n => Number.isInteger(n) && n >= 0 && n <= 65535)) throw new Error('Invalid authoritative score');
  if (typeof outcome.reason !== 'string' || !/^[a-z_]{1,64}$/.test(outcome.reason)) throw new Error('Invalid result reason');
  const abandoned = outcome.abandoned ?? [];
  if (!Array.isArray(abandoned) || abandoned.length > roster.length) throw new Error('Invalid abandonment roster');
  const seen = new Set();
  for (const p of abandoned) {
    if (!p || seen.has(p.id) || !roster.some(r => r.identity === p.id) || !['left_match', 'connection_lost', 'afk'].includes(p.reason)) throw new Error('Invalid abandonment roster');
    seen.add(p.id);
  }
  return { matchId: match.id, mode: match.mode, playlist: match.playlist, winner: outcome.winner, reason: outcome.reason,
    blueScore: outcome.blueScore, orangeScore: outcome.orangeScore, abandoned: abandoned.map(p => ({ id: p.id, reason: p.reason })) };
}
export async function stageResult(pool, id, outcome) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const match = (await client.query('SELECT * FROM arena.matches WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!match) throw new Error('Missing server-created match');
    if (['completed', 'cancelled'].includes(match.status)) {
      await client.query('DELETE FROM arena.pending_results WHERE match_id=$1', [id]);
      await client.query('COMMIT'); return { result: match.result };
    }
    const existing = (await client.query('SELECT outcome FROM arena.pending_results WHERE match_id=$1', [id])).rows[0];
    if (existing) { await client.query('COMMIT'); return { outcome: existing.outcome }; }
    const roster = (await client.query('SELECT * FROM arena.roster WHERE match_id=$1 ORDER BY slot', [id])).rows;
    const value = canonicalOutcome(match, roster, outcome);
    await client.query('INSERT INTO arena.pending_results(match_id,outcome) VALUES($1,$2)', [id, value]);
    await client.query('COMMIT'); return { outcome: value };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
export async function recoverPendingResults(store) {
  let recovered = 0;
  while (true) {
    const { rows } = await store.pool.query('SELECT match_id FROM arena.pending_results ORDER BY recorded_at,match_id LIMIT 100');
    if (!rows.length) return recovered;
    for (const row of rows) { await store.finalize(row.match_id); recovered++; }
  }
}
