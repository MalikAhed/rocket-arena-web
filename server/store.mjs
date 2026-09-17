import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { stageResult, recoverPendingResults } from './result-outbox.mjs';
import { DEFAULT_RATING_CONFIG, initialRating, rateTeams, rankOf } from './rating.mjs';
import { PublicError } from './limits.mjs';
const convert = row => ({ mu: Number(row.mu), uncertainty: Number(row.uncertainty), games: row.games });

export class Store {
  constructor({ connectionString, ssl, season = 'beta-1', rating = DEFAULT_RATING_CONFIG, serverId, onLeaseLost = () => {} }) {
    this.pool = new pg.Pool({ connectionString, ssl, max: 4, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
      statement_timeout: 5000, application_name: 'rocket-arena-online' });
    this.pool.on('error', () => { this.healthy = false; });
    this.season = season; this.rating = rating; this.serverId = serverId; this.onLeaseLost = onLeaseLost;
    this.healthy = false; this.leaseLost = false;
  }
  async migrate() {
    const directory = new URL('./migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()) {
      await this.pool.query(await readFile(new URL(name, directory), 'utf8'));
    }
  }
  async queueResult(id, outcome) { return stageResult(this.pool, id, outcome); }
  async init({ waitForLeaseMs = 0 } = {}) {
    // Single authoritative process only. A session pooler/direct PostgreSQL
    // connection is required; a transaction-mode pooler cannot hold this lease.
    this.lease = await this.pool.connect();
    this.lease.on('error', () => { this.healthy = false; this.leaseLost = true; this.onLeaseLost(); });
    const deadline = performance.now() + waitForLeaseMs;
    while (true) {
      const lock = await this.lease.query("SELECT pg_try_advisory_lock(hashtext('rocket-arena-online-v1')) AS locked");
      if (lock.rows[0].locked) break;
      if (this.closeRequested || performance.now() >= deadline) {
        this.lease.release(); this.lease = null;
        throw new Error('Another authoritative server holds the database lease');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await this.pool.query('INSERT INTO arena.seasons(id,config_version,config) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [this.season, this.rating.version, this.rating]);
    const { rows } = await this.pool.query('SELECT config FROM arena.seasons WHERE id=$1', [this.season]);
    // Configuration is frozen per season so an old result never uses new math.
    if (JSON.stringify(rows[0].config) !== JSON.stringify(JSON.parse(JSON.stringify(this.rating)))) {
      const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
      if (JSON.stringify(stable(rows[0].config)) !== JSON.stringify(stable(this.rating))) throw new Error('Season configuration changed: create an explicit new season');
    }
    // Replay durable completed outcomes before invalidating interrupted games.
    // A replay error fails startup closed; it never erases a queued outcome.
    this.recoveredResults = await recoverPendingResults(this);
    // No leaver penalties for a process failure. Completed results are untouched.
    await this.pool.query("UPDATE arena.matches SET status='cancelled', finished_at=now(), result=jsonb_build_object('status','cancelled','reason','server_restart','changes','[]'::jsonb) WHERE status IN ('reserved','active') AND NOT EXISTS (SELECT 1 FROM arena.pending_results p WHERE p.match_id=arena.matches.id)");
    this.healthy = true;
  }
  async ready() {
    try { const result = await this.pool.query('SELECT version FROM arena.schema_version WHERE version=2'); this.healthy = result.rowCount === 1 && !!this.lease && !this.leaseLost; }
    catch { this.healthy = false; }
    return this.healthy;
  }
  async profile(id, name) {
    await this.pool.query('INSERT INTO arena.profiles(id,display_name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [id, name]);
    return this.getProfile(id);
  }
  async rename(id, name) {
    await this.pool.query('UPDATE arena.profiles SET display_name=$2,updated_at=now() WHERE id=$1', [id, name]);
    return this.getProfile(id);
  }
  async getProfile(id) {
    const { rows: profiles } = await this.pool.query('SELECT display_name FROM arena.profiles WHERE id=$1', [id]);
    if (!profiles.length) throw new PublicError('profile_missing');
    const { rows } = await this.pool.query("SELECT playlist,mu,uncertainty,games FROM arena.ratings WHERE player_id=$1 AND season_id=$2 AND mode='ranked'", [id, this.season]);
    const progress = [1, 2, 3].map(playlist => { const found = rows.find(row => row.playlist === playlist); const rating = found ? convert(found) : initialRating(this.rating); return { playlist, ...rating, rank: rankOf(rating, this.rating) }; });
    return { id, name: profiles[0].display_name, season: this.season, progress };
  }
  async history(id) {
    return (await this.pool.query('SELECT match_id,playlist,mode,previous,current,delta,created_at FROM arena.rating_history WHERE player_id=$1 ORDER BY created_at DESC LIMIT 30', [id])).rows;
  }
  async ratingFor(id, playlist, mode) {
    const { rows } = await this.pool.query('SELECT mu,uncertainty,games FROM arena.ratings WHERE player_id=$1 AND season_id=$2 AND playlist=$3 AND mode=$4', [id, this.season, playlist, mode]);
    return rows.length ? convert(rows[0]) : initialRating(this.rating);
  }
  async checkCooldown(id) {
    const { rows } = await this.pool.query('SELECT until_at FROM arena.penalties WHERE player_id=$1 AND until_at>now()', [id]);
    if (rows.length) throw new PublicError('cooldown', `Ranked cooldown until ${rows[0].until_at.toISOString()}`);
  }
  async reserve(room) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO arena.matches(id,server_id,season_id,config_version,playlist,mode,region,private,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'reserved')", [room.id, this.serverId, this.season, this.rating.version, room.size, room.mode, room.region, room.private]);
      for (const [slot, p] of room.players.entries()) await c.query('INSERT INTO arena.roster(match_id,slot,identity,player_id,team,display_name,visual,is_test) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [room.id, slot, p.id, p.accountId ?? null, p.team, p.name, p.visual, !!p.isTest]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async activate(id) { await this.pool.query("UPDATE arena.matches SET status='active',started_at=now() WHERE id=$1 AND status='reserved'", [id]); }
  async cancel(id, reason) {
    const result = { status: 'cancelled', reason, changes: [] }, c = await this.pool.connect();
    let pending = false, saved = result;
    try {
      await c.query('BEGIN');
      const match = (await c.query('SELECT status,result FROM arena.matches WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (match && ['completed', 'cancelled'].includes(match.status)) saved = match.result;
      else if (match) {
        pending = (await c.query('SELECT 1 FROM arena.pending_results WHERE match_id=$1', [id])).rowCount > 0;
        if (!pending) await c.query("UPDATE arena.matches SET status='cancelled',result=$2,finished_at=now() WHERE id=$1", [id, result]);
      }
      await c.query('COMMIT');
    } catch (error) { await c.query('ROLLBACK').catch(() => {}); throw error; }
    finally { c.release(); }
    // A confirmed outcome wins a race against cancellation/restart cleanup.
    return pending ? this.finalize(id) : saved;
  }
  async finalize(id, outcome) {
    const staged = await this.queueResult(id, outcome);
    if (staged.result) return staged.result;
    outcome = staged.outcome; // First durable server outcome wins every retry.
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const { rows: matches } = await c.query('SELECT * FROM arena.matches WHERE id=$1 FOR UPDATE', [id]);
      const match = matches[0];
      if (!match) throw new Error('Missing server-created match');
      if (['completed', 'cancelled'].includes(match.status)) { await c.query('COMMIT'); return match.result; }
      if (match.status !== 'active' || ![0, 1].includes(outcome.winner)) throw new Error('Ineligible match result');
      const { rows: roster } = await c.query('SELECT * FROM arena.roster WHERE match_id=$1 ORDER BY player_id NULLS LAST,slot', [id]);
      if (roster.length !== match.playlist * 2 || roster.filter(p => p.team === 0).length !== match.playlist) throw new Error('Incomplete match roster');
      const eligible = !match.private && !roster.some(p => p.is_test);
      if (match.mode === 'ranked' && (!eligible || roster.some(p => !p.player_id))) throw new Error('Ranked eligibility rejected');
      const cfg = (await c.query('SELECT config FROM arena.seasons WHERE id=$1', [match.season_id])).rows[0].config;
      const players = [];
      for (const p of roster) {
        if (p.player_id && eligible) {
          await c.query('INSERT INTO arena.ratings(player_id,season_id,playlist,mode,mu,uncertainty,games) VALUES($1,$2,$3,$4,$5,$6,0) ON CONFLICT DO NOTHING', [p.player_id, match.season_id, match.playlist, match.mode, cfg.initial, cfg.initialUncertainty]);
          const { rows } = await c.query('SELECT mu,uncertainty,games FROM arena.ratings WHERE player_id=$1 AND season_id=$2 AND playlist=$3 AND mode=$4 FOR UPDATE', [p.player_id, match.season_id, match.playlist, match.mode]);
          players.push({ id: p.identity, accountId: p.player_id, team: p.team, ...convert(rows[0]) });
        } else players.push({ id: p.identity, team: p.team, ...initialRating(cfg) });
      }
      const changes = eligible ? rateTeams(players, outcome.winner, cfg, match.mode === 'casual') : [];
      for (const change of changes) {
        const p = players.find(p => p.id === change.id);
        if (!p.accountId) continue;
        await c.query('UPDATE arena.ratings SET mu=$5,uncertainty=$6,games=$7,updated_at=now() WHERE player_id=$1 AND season_id=$2 AND playlist=$3 AND mode=$4', [p.accountId, match.season_id, match.playlist, match.mode, change.after.mu, change.after.uncertainty, change.after.games]);
        await c.query('INSERT INTO arena.rating_history(match_id,player_id,season_id,playlist,mode,previous,current,delta) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, p.accountId, match.season_id, match.playlist, match.mode, change.before, change.after, change.delta]);
      }
      // Only a completed eligible Ranked match can apply abandonment penalties.
      if (match.mode === 'ranked') for (const abandoned of outcome.abandoned ?? []) {
        const p = roster.find(p => p.identity === abandoned.id);
        if (!p?.player_id) continue;
        const { rows } = await c.query('SELECT strikes,last_at FROM arena.penalties WHERE player_id=$1 FOR UPDATE', [p.player_id]);
        const previous = rows[0];
        const strikes = previous && Date.now() - previous.last_at.getTime() < 86400000 ? previous.strikes + 1 : 1;
        const seconds = Math.min(3600, 300 * 2 ** Math.min(strikes - 1, 4));
        await c.query("INSERT INTO arena.penalties(player_id,strikes,until_at,last_at) VALUES($1,$2,now()+($3*interval '1 second'),now()) ON CONFLICT(player_id) DO UPDATE SET strikes=$2,until_at=now()+($3*interval '1 second'),last_at=now()", [p.player_id, strikes, seconds]);
        await c.query('INSERT INTO arena.abandonments(match_id,player_id,reason,cooldown_seconds) VALUES($1,$2,$3,$4)', [id, p.player_id, abandoned.reason, seconds]);
      }
      const result = { ...outcome, status: 'completed', matchId: id, mode: match.mode, playlist: match.playlist, season: match.season_id,
        ratingVersion: match.config_version, changes: match.mode === 'ranked' ? changes : [] };
      await c.query("UPDATE arena.matches SET status='completed',result=$2,finished_at=now() WHERE id=$1", [id, result]);
      await c.query('DELETE FROM arena.pending_results WHERE match_id=$1', [id]);
      await c.query('COMMIT');
      return result;
    } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
  }
  async close() {
    if (this.lease) { try { await this.lease.query("SELECT pg_advisory_unlock(hashtext('rocket-arena-online-v1'))"); } catch {} this.lease.release(); this.lease = null; }
    await this.pool.end();
  }
}
