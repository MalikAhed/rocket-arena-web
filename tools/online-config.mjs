export function onlineConfiguration(env = process.env) {
  const serverUrl = (env.ONLINE_SERVER_URL || '').replace(/\/$/, '');
  if (serverUrl) {
    const url = new URL(serverUrl);
    if (url.origin !== serverUrl || url.username || !['https:', 'http:'].includes(url.protocol) || url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('ONLINE_SERVER_URL must be an HTTPS origin (localhost HTTP only for development)');
  }
  const supabaseUrl = env.SUPABASE_URL || '', publishableKey = env.SUPABASE_PUBLISHABLE_KEY || '';
  if (publishableKey.startsWith('sb_secret_')) throw Error('Never expose a Supabase secret key in frontend configuration');
  if (publishableKey.split('.').length === 3) {
    try { if (JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url').toString()).role !== 'anon') throw Error('not_public'); }
    catch { throw Error('Only publishable/anon Supabase keys belong in the frontend'); }
  }
  return { serverUrl, supabaseUrl, publishableKey };
}
