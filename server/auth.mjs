import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { validName } from '../src/online/protocol.js';
import { PublicError } from './limits.mjs';
const digest = token => createHash('sha256').update(token).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class Sessions {
  constructor({ supabaseUrl = '', publicKey = '', store = null, max = 2048, fetchImpl = fetch }) {
    this.url = supabaseUrl.replace(/\/$/, ''); this.key = publicKey; this.store = store; this.max = max; this.fetch = fetchImpl;
    this.items = new Map();
  }
  get configured() { return !!(this.url && this.key && this.store); }
  async verify(accessToken) {
    if (!this.configured) throw new PublicError('accounts_unconfigured');
    if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 4096) throw new PublicError('sign_in_required');
    let response;
    try { response = await this.fetch(`${this.url}/auth/v1/user`, { headers: { apikey: this.key, Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(6000) }); }
    catch { throw new PublicError('auth_unavailable'); }
    if (!response.ok) throw new PublicError(response.status === 401 || response.status === 403 ? 'session_expired' : 'auth_unavailable');
    const user = await response.json();
    if (!UUID.test(user.id) || user.is_anonymous) throw new PublicError('sign_in_required');
    return user.id;
  }
  sweep(now = Date.now()) { for (const [key, session] of this.items) if (session.expires < now && !session.active) this.items.delete(key); }
  async create({ name, accessToken, oldToken } = {}) {
    if (!validName(name)) throw new PublicError('invalid_name', 'Use 2–24 letters, numbers, spaces, underscores or hyphens. System names are reserved.');
    this.sweep();
    if (this.items.size >= this.max) throw new PublicError('server_at_capacity');
    let id, accountId = null, profile = null;
    if (accessToken) {
      accountId = await this.verify(accessToken); id = `u:${accountId}`;
      profile = await this.store.profile(accountId, name); name = profile.name;
    } else id = `g:${randomUUID()}`;
    // Refresh an existing game session without replacing its player identity.
    const old = oldToken && this.get(oldToken, { allowExpired: true });
    if (old && (accountId ? old.accountId === accountId : !old.accountId)) {
      old.expires = Date.now() + (accountId ? 3600000 : 86400000); old.accessToken = accessToken ?? null; old.name = name;
      return { token: oldToken, player: this.public(old), profile, expires: old.expires };
    }
    const token = randomBytes(32).toString('base64url');
    const session = { id, accountId, name, accessToken: accessToken ?? null, isTest: false,
      expires: Date.now() + (accountId ? 3600000 : 86400000), active: false, casual: new Map() };
    this.items.set(digest(token), session);
    return { token, player: this.public(session), profile, expires: session.expires };
  }
  get(token, { allowExpired = false } = {}) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = this.items.get(digest(token));
    return session && (allowExpired || session.expires > Date.now() || session.active) ? session : null;
  }
  revoke(token) { if (typeof token === 'string') this.items.delete(digest(token)); }
  public(session) { return { id: session.id, name: session.name, registered: !!session.accountId }; }
  async requireRanked(session) {
    if (!session?.accountId || session.isTest) throw new PublicError('sign_in_required');
    if (session.expires <= Date.now()) throw new PublicError('session_expired');
    if (!this.store?.healthy) throw new PublicError('database_unavailable');
    if (await this.verify(session.accessToken) !== session.accountId) throw new PublicError('session_expired');
    await this.store.checkCooldown(session.accountId);
  }
}
