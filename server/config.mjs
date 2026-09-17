import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEFAULT_RATING_CONFIG, validateRatingConfig } from './rating.mjs';
const number = (env, key, fallback, min, max) => {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
};
export function configuration(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origins = (env.ALLOWED_ORIGINS ?? 'http://localhost:4173,http://127.0.0.1:4173').split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length || origins.some(origin => { try { const u = new URL(origin); return u.origin !== origin || !['https:', ...(production ? [] : ['http:'])].includes(u.protocol); } catch { return true; } })) throw new Error('ALLOWED_ORIGINS must contain exact HTTPS origins (HTTP is local-development only)');
  if (production && (env.TEST_AUTH || env.DEV_AUTH || env.ALLOW_TEST_USERS)) throw new Error('Test authentication is prohibited in production');
  const supabaseUrl = env.SUPABASE_URL ?? '';
  if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) throw new Error('SUPABASE_URL must be a hosted Supabase project URL');
  if (production && env.DATABASE_URL && env.DATABASE_SSL !== 'verify-full') throw new Error('Production PostgreSQL requires DATABASE_SSL=verify-full');
  const rating = validateRatingConfig(env.RATING_CONFIG_FILE ? JSON.parse(readFileSync(env.RATING_CONFIG_FILE, 'utf8')) : DEFAULT_RATING_CONFIG);
  return { production, serverId: randomUUID(), host: env.HOST ?? '0.0.0.0', port: number(env, 'PORT', 8080, 0, 65535), origins,
    region: env.REGION ?? 'local', maxRooms: number(env, 'MAX_ROOMS', 2, 1, 8), maxConnections: number(env, 'MAX_CONNECTIONS', 48, 2, 256),
    supabaseUrl, publicKey: env.SUPABASE_PUBLISHABLE_KEY ?? '', databaseUrl: env.DATABASE_URL ?? '',
    ssl: env.DATABASE_SSL === 'verify-full' ? { rejectUnauthorized: true, ...(env.DATABASE_CA_FILE ? { ca: readFileSync(env.DATABASE_CA_FILE, 'utf8') } : {}) } : undefined,
    season: env.SEASON_ID ?? 'beta-1', rating,
    roomConfig: { graceMs: number(env, 'RECONNECT_GRACE_SECONDS', 30, 5, 120) * 1000 },
  };
}
