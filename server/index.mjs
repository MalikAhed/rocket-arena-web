import http from 'node:http';
import { NETWORK_CORE_SHA256 } from '../src/physics/network-core.js';
import { TimingWindow } from '../src/online/timing.js';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { configuration } from './config.mjs';
import { Sessions } from './auth.mjs';
import { Store } from './store.mjs';
import { Lobby } from './lobby.mjs';
import { BoundedRates, TokenBucket, PublicError } from './limits.mjs';
import { PROTOCOL, PHYSICS_SHA256, SIM_HZ, readMessage, validName } from '../src/online/protocol.js';

async function bodyJSON(request) {
  let text = '', size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 8192) throw new PublicError('payload_too_large'); text += chunk; }
  try { return JSON.parse(text); } catch { throw new PublicError('invalid_request'); }
}
const publicError = error => ({ type: 'error', code: error instanceof PublicError ? error.code : 'server_unavailable',
  message: error instanceof PublicError ? error.message : 'The service could not complete this request. Try again.' });
export async function createGameServer(config = configuration(), dependencies = {}) {
  let lobby;
  const store = dependencies.store ?? (config.databaseUrl ? new Store({ connectionString: config.databaseUrl, ssl: config.ssl, season: config.season,
    rating: config.rating, serverId: config.serverId, onLeaseLost: () => lobby?.shutdown('database_lease_lost') }) : null);
  const sessions = dependencies.sessions ?? new Sessions({ supabaseUrl: config.supabaseUrl, publicKey: config.publicKey, store });
  lobby = new Lobby({ sessions, store, region: config.region, maxRooms: config.maxRooms, roomConfig: config.roomConfig, privateConfig: config.privateConfig });
  lobby.initializing = !!store && !dependencies.store;
  const rates = new BoundedRates(), peers = new Set();
  const metrics = { ticks: 0, stalls: 0, maxStepMs: 0, sentBytes: 0, skippedSnapshots: 0, started: Date.now() };
  const stepTiming = new TimingWindow(), eventLoopTiming = new TimingWindow();
  let timingReport = {};
  const originAllowed = origin => config.origins.includes(origin);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = request.headers.origin;
    const send = (status, value) => { if (!response.headersSent) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); } };
    if (origin) {
      if (!originAllowed(origin)) { send(403, { error: 'origin_forbidden' }); return; }
      response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Game-Session');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    const path = new URL(request.url, 'http://server.invalid').pathname;
    try {
      if (request.method === 'GET' && ['/healthz', '/readyz'].includes(path)) {
        const ready = !lobby.stopping && !lobby.initializing && (!store || store.healthy);
        send(path === '/readyz' && !ready ? 503 : 200, { status: lobby.stopping ? 'draining' : lobby.initializing ? 'warming' : 'ok', ready, protocol: PROTOCOL,
          physics: PHYSICS_SHA256, nativeCheckpoint: 1, nativePhysics: NETWORK_CORE_SHA256, region: config.region, ranked: sessions.configured && !!store?.healthy,
          rooms: lobby.rooms.size, capacity: config.maxRooms, beta: true, build: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || 'local' }); return;
      }
      if (!originAllowed(origin)) throw new PublicError('origin_forbidden');
      if (lobby.initializing) throw new PublicError('server_warming', 'The replacement server is warming up. No new matches can start yet.');
      const ip = request.socket.remoteAddress;
      if (!rates.take(`http:${ip}`, 1, 20)) throw new PublicError('rate_limited');
      if (request.method === 'POST' && path === '/session') {
        const body = await bodyJSON(request);
        const accessToken = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined;
        const result = await sessions.create({ name: body.name, accessToken, oldToken: request.headers['x-game-session'] });
        send(200, result); return;
      }
      const token = request.headers['x-game-session'];
      const session = sessions.get(token);
      if (!session?.accountId) throw new PublicError('sign_in_required');
      if (request.method === 'GET' && path === '/profile') { send(200, await store.getProfile(session.accountId)); return; }
      if (request.method === 'GET' && path === '/history') { send(200, await store.history(session.accountId)); return; }
      if (request.method === 'POST' && path === '/profile') {
        if (lobby.entries.has(session.id)) throw new PublicError('leave_before_renaming');
        const body = await bodyJSON(request); if (!validName(body.name)) throw new PublicError('invalid_name');
        await sessions.requireRanked(session); session.name = body.name;
        send(200, await store.rename(session.accountId, body.name)); return;
      }
      if (request.method === 'POST' && path === '/logout') { lobby.leave(session); sessions.revoke(token); lobby.peers.get(session.id)?.close(1000, 'signed_out'); send(200, { signedOut: true }); return; }
      send(404, { error: 'not_found' });
    } catch (error) { const safe = publicError(error); send(safe.code === 'rate_limited' ? 429 : safe.code === 'server_unavailable' || safe.code === 'server_warming' || safe.code.endsWith('unavailable') ? 503 : 400, safe); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url, 'http://server.invalid').pathname !== '/play' || !originAllowed(request.headers.origin) || lobby.stopping || lobby.initializing || peers.size >= config.maxConnections || !rates.take(`ws:${request.socket.remoteAddress}`, 0.2, 8)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  wss.on('connection', ws => {
    const peer = {
      ws, session: null, lastPong: performance.now(), messageLimit: new TokenBucket(120, 180), inputLimit: new TokenBucket(90, 120), controlLimit: new TokenBucket(3, 12), authenticating: false,
      send(message) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); },
      sendBinary(binary) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 262144) { ws.close(1013, 'slow_connection'); return; }
        if (ws.bufferedAmount > 16384) { metrics.skippedSnapshots++; return; }
        ws.send(binary); metrics.sentBytes += binary.byteLength;
      },
      close(code, reason) { ws.close(code, reason); },
    };
    peers.add(peer);
    const timeout = setTimeout(() => { if (!peer.session) ws.close(4003, 'authentication_timeout'); }, 8000);
    peer.pingAt = performance.now(); ws.ping();
    ws.on('pong', () => { peer.lastPong = performance.now(); peer.rtt = peer.pingAt ? Math.round(peer.lastPong - peer.pingAt) : null; });
    ws.on('error', () => {});
    ws.on('close', () => { clearTimeout(timeout); peers.delete(peer); if (peer.session) lobby.detach(peer.session, peer); });
    ws.on('message', async (data, isBinary) => {
      try {
        if (!peer.messageLimit.take()) throw new PublicError('rate_limited');
        if (isBinary) throw new PublicError('invalid_message');
        let message;
        try { message = readMessage(data.toString()); } catch { throw new PublicError('invalid_message'); }
        if (message.type === 'input') {
          if (!peer.session || !peer.inputLimit.take() || lobby.peers.get(peer.session.id) !== peer) throw new PublicError('invalid_input');
          if (!Number.isSafeInteger(message.epoch)) throw new PublicError('invalid_input');
          lobby.roomFor(peer.session, message.matchId).input(peer.session.id, message.seq, message.controls, performance.now(), message.epoch); return;
        }
        if (!peer.controlLimit.take()) throw new PublicError('rate_limited');
        if (!peer.session) {
          if (message.type !== 'hello' || peer.authenticating) throw new PublicError('sign_in_required');
          if (message.protocol !== PROTOCOL || message.physics !== PHYSICS_SHA256) throw new PublicError('update_required', 'Client and server versions differ. Reload after the client deployment is updated.');
          const session = sessions.get(message.token);
          if (!session) throw new PublicError('session_expired');
          peer.nativeCheckpoint = message.nativeCheckpoint === 1;
          peer.authenticating = true;
          lobby.attach(session, peer); clearTimeout(timeout); return;
        }
        if (lobby.peers.get(peer.session.id) !== peer) throw new PublicError('session_replaced');
        if (message.type === 'queue') await lobby.join(peer.session, message);
        else if (message.type === 'private_create') lobby.privateRooms.create(peer.session, message);
        else if (message.type === 'private_join') lobby.privateRooms.join(peer.session, message);
        else if (message.type === 'private_team') lobby.privateRooms.team(peer.session, message.team);
        else if (message.type === 'private_start') lobby.privateRooms.start(peer.session);
        else if (message.type === 'cancel') lobby.cancel(peer.session, message.request);
        else if (message.type === 'ready') await lobby.roomFor(peer.session, message.matchId).markReady(peer.session.id);
        else if (message.type === 'leave') lobby.leave(peer.session);
        else if (message.type === 'forfeit') lobby.roomFor(peer.session, message.matchId).forfeit(peer.session.id);
        else if (message.type === 'ping') peer.send({ type: 'pong', nonce: message.nonce, rtt: peer.rtt ?? null, serverTiming: timingReport });
        else throw new PublicError('invalid_message');
      } catch (error) {
        const safe = publicError(error); peer.send(safe);
        if (['invalid_input', 'input_backlog', 'invalid_message', 'rate_limited', 'update_required', 'session_expired', 'session_replaced'].includes(safe.code)) ws.close(4002, safe.code);
      }
    });
  });
  let previous = performance.now(), accumulator = 0, lastHousekeeping = previous, lastHeartbeat = previous;
  const timer = setInterval(() => {
    const now = performance.now(), elapsed = now - previous; previous = now;
    eventLoopTiming.add(Math.max(0, elapsed - 4));
    // Confirmed server stalls are infrastructure failures, never player cheating.
    if (elapsed > 2000) { metrics.stalls++; for (const room of lobby.rooms.values()) if (!room.terminal) room.cancel('server_overloaded'); accumulator = 0; }
    else accumulator += elapsed;
    const start = performance.now();
    let count = 0;
    while (accumulator >= 1000 / SIM_HZ && count++ < 24) { lobby.step(now, true); accumulator -= 1000 / SIM_HZ; metrics.ticks++; }
    lobby.flushSnapshots();
    if (accumulator > 2000) { lobby.shutdown('server_overloaded'); accumulator = 0; }
    const stepMs = performance.now() - start; stepTiming.add(stepMs);
    metrics.maxStepMs = Math.max(metrics.maxStepMs, stepMs);
    if (now - lastHousekeeping >= 250) { lobby.update(now); lobby.matchmake(now); lastHousekeeping = now; }
    if (now - lastHeartbeat >= 5000) {
      for (const peer of peers) {
        if (now - peer.lastPong > 15000) peer.ws.terminate();
        else if (peer.ws.readyState === WebSocket.OPEN) { peer.pingAt = now; peer.ws.ping(); }
      }
      sessions.sweep(); rates.sweep(); lastHeartbeat = now;
      timingReport = { tickBatch: stepTiming.summary(), eventLoopDelay: eventLoopTiming.summary(), targetHz: SIM_HZ, skippedSnapshots: metrics.skippedSnapshots };
    }
  }, 4);
  const readiness = store ? setInterval(() => { void store.ready(); }, 15000) : null;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  // Liveness binds before the exclusive database lease is acquired. Render
  // can route a replacement and terminate the old process; readiness remains
  // false throughout this deliberate beta maintenance window. No split brain.
  const initialization = lobby.initializing
    ? store.init({ waitForLeaseMs: 120000 }).then(() => { lobby.initializing = false; return true; })
      .catch(() => { lobby.initializing = false; lobby.shutdown('database_startup_failed'); return false; })
    : Promise.resolve(true);
  return { server, wss, lobby, sessions, store, metrics, initialization, port: server.address().port,
    async close() {
      clearInterval(timer); clearInterval(readiness);
      if (store && !dependencies.store) store.closeRequested = true;
      await initialization;
      lobby.shutdown();
      const pending = [...lobby.rooms.values()];
      await Promise.all(pending.map(room => room.persist()));
      const deadline = performance.now() + 6000;
      while (pending.some(room => room.busy) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      for (const peer of peers) peer.ws.terminate();
      for (const room of [...lobby.rooms.values()]) room.dispose();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
      if (store && !dependencies.store) await store.close();
    } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createGameServer();
  console.log(JSON.stringify({ event: 'listening', port: app.port, protocol: PROTOCOL, region: app.lobby.region, ranked: app.sessions.configured }));
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
    if (closing) return; closing = true;
    const forced = setTimeout(() => process.exit(1), 8000); forced.unref();
    await app.close(); process.exit(0);
  });
  if (!await app.initialization) { await app.close(); process.exitCode = 1; }
}
