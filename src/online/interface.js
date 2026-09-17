import { Transport } from './transport.js';
import { Prediction } from './prediction.js';
import { controlsArray, validName, NEUTRAL } from './protocol.js';
import { accountClient, currentAccount } from './account.js';
const storage = {
  get(key) { try { return JSON.parse(sessionStorage.getItem(`arena.online.${key}`)); } catch { return null; } },
  set(key, value) { try { value === null ? sessionStorage.removeItem(`arena.online.${key}`) : sessionStorage.setItem(`arena.online.${key}`, JSON.stringify(value)); } catch {} },
};
const friendly = {
  connecting: 'Connecting to the game server…', reconnecting: 'Connection lost. Reconnecting to your original slot…',
  server_unavailable: 'The game server is unavailable. No match is being simulated locally. You can return to offline play.',
  update_required: 'Client and server versions differ. Reload after the game has been updated.',
  accounts_unconfigured: 'Accounts are not configured on this server. Casual does not require an account.',
  sign_in_required: 'Sign in or create your player account to enter Ranked.', session_expired: 'Your session expired. Sign in again.',
  database_unavailable: 'Ranked storage is unavailable. No rating update has been confirmed.',
  ready_timeout: 'The match was cancelled because a player did not finish loading. No rating change.',
  reconnect_expired: 'The reconnection grace period has expired. An eligible Ranked match can still affect your rating.',
};
function explain(code) { return friendly[code] ?? String(code).replaceAll('_', ' '); }
export function mountOnline(root, hooks) {
  let config, transport, prediction, session = storage.get('session'), authSession, profile;
  let active = false, mode = 'casual', size = 1, request = 0, searching = false, generation = 0;
  let matchId = null, reservation = null, latestSnapshot = null, preparing = false, lastResult = null;
  let lastSnapshotAt = 0, queueSent = false, poll = 0, oldButtons = [], lastDirection = 0;
  const panel = document.createElement('section'); panel.className = 'online-panel sheet-overlay'; panel.hidden = true;
  panel.innerHTML = `<div class="online-dialog" role="dialog" aria-modal="true" aria-labelledby="online-title">
    <header class="online-heading"><div><p class="online-eyebrow">ROCKET ARENA · ONLINE BETA</p><h1 id="online-title">CASUAL</h1></div><button type="button" data-online="back" class="online-close" aria-label="Back to Play">×</button></header>
    <p class="online-subtitle">Real players. One shared arena. No replacement bots.</p>
    <form class="online-form">
      <div class="online-playlists" role="group" aria-label="Online playlist">${[1, 2, 3].map(n => `<button type="button" data-size="${n}" aria-pressed="${n === 1}" class="online-playlist"><img src="/assets/online/illustrations.svg#team-${n}" alt="" draggable="false"><strong>${n}v${n}</strong><small>${['DUEL', 'DOUBLES', 'STANDARD'][n - 1]}</small></button>`).join('')}</div>
      <div class="online-account-row"><label class="online-name">DISPLAY NAME<input name="displayName" autocomplete="nickname" minlength="2" maxlength="24" value="Player" required></label><div class="online-identity">Guest · Casual only</div></div>
      <p class="online-status" role="status" aria-live="polite">Select a playlist to begin.</p>
      <div class="online-progress" hidden></div>
      <div class="online-results" hidden></div>
      <div class="online-actions"><button type="submit" data-online="search" class="online-primary">FIND MATCH</button><button type="button" data-online="cancel" hidden>CANCEL SEARCH</button><button type="button" data-online="signin">SIGN IN / CREATE ACCOUNT</button><button type="button" data-online="signout" hidden>SIGN OUT</button><button type="button" data-online="again" hidden>PLAY AGAIN</button><button type="button" data-online="bots">PLAY BOTS OFFLINE</button></div>
      <p class="online-account-help">Ranked accounts use GitHub sign-in. <a href="https://github.com/password_reset" target="_blank" rel="noopener noreferrer">Recover your GitHub account</a>. No email or password is needed for guest Casual.</p>
    </form>
  </div>`;
  const hud = document.createElement('section'); hud.className = 'online-hud'; hud.hidden = true;
  hud.innerHTML = '<div class="online-score"><b data-score="blue">0</b><span data-clock>5:00</span><b data-score="orange">0</b></div><p class="online-banner"></p><div class="online-roster"></div><div class="online-network"></div><button type="button" data-forfeit>VOTE TO FORFEIT</button><button type="button" data-leave>LEAVE ONLINE</button>';
  root.append(panel, hud);
  const find = selector => panel.querySelector(selector), status = find('.online-status');
  const input = find('input'), submit = find('[data-online="search"]');
  const setStatus = text => { status.textContent = text; };
  function show() {
    panel.hidden = false; hooks.modal(true); root.classList.add('online-menu');
    cancelAnimationFrame(poll); poll = requestAnimationFrame(gamepad); find('[data-size="' + size + '"]')?.focus();
  }
  function hide() { panel.hidden = true; hooks.modal(false); root.classList.remove('online-menu'); cancelAnimationFrame(poll); }
  function gamepad(now) {
    if (panel.hidden) return;
    const pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
    if (pad) {
      const buttons = pad.buttons.map(b => b.pressed);
      const direction = buttons[13] || buttons[15] || pad.axes[1] > 0.55 || pad.axes[0] > 0.55 ? 1 : buttons[12] || buttons[14] || pad.axes[1] < -0.55 || pad.axes[0] < -0.55 ? -1 : 0;
      if (direction && now - lastDirection > 220) { move(direction); lastDirection = now; }
      if (buttons[0] && !oldButtons[0] && panel.contains(document.activeElement)) document.activeElement.click();
      if (buttons[1] && !oldButtons[1]) back(); oldButtons = buttons;
    }
    poll = requestAnimationFrame(gamepad);
  }
  function focusables() { return [...panel.querySelectorAll('button,input,a')].filter(e => !e.disabled && !e.closest('[hidden]')); }
  function move(direction) { const options = focusables(); options[(options.indexOf(document.activeElement) + direction + options.length) % options.length]?.focus(); }
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); back(); }
    else if (event.key === 'Tab') { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
    else if (!(event.target instanceof HTMLInputElement) && event.key.startsWith('Arrow')) { event.preventDefault(); move(['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1); }
  });
  function controls() {
    submit.hidden = active || searching || mode === 'ranked' && !authSession;
    submit.disabled = !config?.serverUrl || preparing;
    find('[data-online="cancel"]').hidden = !searching;
    find('[data-online="signin"]').hidden = !!authSession || active || searching;
    find('[data-online="signout"]').hidden = !authSession || active || searching;
    find('[data-online="again"]').hidden = !lastResult;
    find('.online-playlists').hidden = active || !!lastResult;
    find('.online-account-row').hidden = active || !!lastResult;
    input.disabled = active || searching || !!authSession;
    for (const button of panel.querySelectorAll('[data-size]')) button.disabled = searching || preparing;
    find('.online-identity').textContent = profile ? `${profile.name} · Player account` : 'Guest · Casual only';
    const progress = find('.online-progress'), rating = profile?.progress?.find(p => p.playlist === size);
    progress.hidden = mode !== 'ranked' || !rating || active;
    if (!progress.hidden) {
      progress.replaceChildren(); const badge = document.createElement('img'); badge.src = `/assets/online/ranks.svg#rank-${rating.rank.badge}`; badge.alt = '';
      const text = document.createElement('span'); text.textContent = `${rating.rank.name}${rating.rank.division ? ` · Division ${rating.rank.division}` : ''} · ${rating.games < 10 ? `${rating.games}/10 placements` : `${rating.mu.toFixed(0)} MMR`}`;
      progress.append(badge, text);
    }
    for (const button of panel.querySelectorAll('[data-size]')) button.setAttribute('aria-pressed', String(Number(button.dataset.size) === size));
    find('#online-title').textContent = lastResult ? (lastResult.status === 'cancelled' ? 'NO CONTEST' : 'MATCH COMPLETE') : mode.toUpperCase();
    find('.online-subtitle').textContent = mode === 'ranked' ? 'Online · Account required · Independent ranks for each playlist' : 'Online · Guests welcome · Casual never changes Ranked MMR';
  }
  async function loadConfig() {
    config ??= await (await fetch('/assets/online/config.json', { cache: 'no-store' })).json();
    if (config.serverUrl) {
      const url = new URL(config.serverUrl);
      if (url.origin !== config.serverUrl || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('Invalid online service configuration.');
    }
    return config;
  }
  async function api(path, { body, accessToken, token } = {}) {
    const response = await fetch(config.serverUrl + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(token ? { 'X-Game-Session': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    const result = await response.json(); if (!response.ok) throw Error(result.message || explain(result.code || result.error || 'server_unavailable'));
    return result;
  }
  async function establishSession() {
    if (authSession) authSession = await currentAccount(config);
    const name = profile?.name ?? input.value.trim();
    if (!validName(name)) throw Error('Use 2–24 letters, numbers, spaces, underscores or hyphens. System names are reserved.');
    session = await api('/session', { body: { name }, accessToken: authSession?.access_token,
      token: session?.serverUrl === config.serverUrl ? session.token : undefined });
    session.serverUrl = config.serverUrl; storage.set('session', session);
    if (session.profile) profile = session.profile;
    return session;
  }
  async function open(nextMode, nextSize = 1) {
    mode = nextMode; size = nextSize; lastResult = null; find('.online-results').hidden = true; show();
    setStatus('Checking online configuration…'); controls();
    try {
      await loadConfig();
      if (config.supabaseUrl && config.publishableKey) authSession = await currentAccount(config);
      if (authSession && config.serverUrl) { await establishSession(); input.value = profile.name; }
      setStatus(!config.serverUrl ? 'Online play is not configured for this build. Bots and Free Play still work offline.' : mode === 'ranked' && !authSession ? friendly.sign_in_required : 'Choose a playlist, then find a match. Matches start only when every human player is ready.');
    } catch (error) { setStatus(error.message); }
    controls();
  }
  async function search() {
    if (searching || preparing || active) return;
    const attempt = ++generation; preparing = true; lastResult = null; controls(); setStatus('Checking the game server…');
    try {
      if (!config?.serverUrl) throw Error('Online play is not configured for this build.');
      const health = await api('/readyz');
      if (!health.ready) throw Error(friendly.server_unavailable);
      if (mode === 'ranked' && !health.ranked) throw Error('Ranked is unavailable: this server needs working account verification and durable storage.');
      if (attempt !== generation) return;
      await establishSession(); if (attempt !== generation) return;
      queueSent = false; searching = true; request++; stopTransport();
      transport = new Transport({ serverUrl: config.serverUrl, token: session.token, onMessage, onSnapshot, onState });
      transport.connect();
    } catch (error) { setStatus(error.message); }
    finally { preparing = false; controls(); }
  }
  function onState(state) {
    if (state !== 'connected') setStatus(explain(state));
    hud.querySelector('.online-network').textContent = state === 'connected' ? `${reservation?.region ?? 'Server'} · connected` : explain(state);
    if (state === 'server_unavailable' || state === 'update_required') { searching = false; preparing = false; show(); controls(); }
  }
  async function onMessage(message) {
    if (message.type === 'connected' && searching && !queueSent) {
      queueSent = true;
      transport.send({ type: 'queue', mode, size, region: message.region, visual: hooks.visual(), request });
    } else if (message.type === 'searching') setStatus(`Searching for ${message.size}v${message.size} players in ${message.region}. Cancel at any time.`);
    else if (message.type === 'capacity') setStatus('The server is at capacity. Your search is queued; cancel or switch to Bots.');
    else if (message.type === 'loading') setStatus('Match reserved. Loading the shared arena…');
    else if (message.type === 'waiting') { setStatus(`Waiting for players: ${message.ready}/${message.required} ready.`); hud.querySelector('.online-banner').textContent = `WAITING FOR PLAYERS · ${message.ready}/${message.required}`; }
    else if (message.type === 'reserved') await join(message);
    else if (message.type === 'search_cancelled') { searching = false; setStatus('Search cancelled.'); controls(); }
    else if (message.type === 'kickoff') { hide(); hooks.resume(); }
    else if (message.type === 'cancelled') { searching = false; setStatus(`Match cancelled: ${explain(message.reason)}. No rating change.`); show(); controls(); storage.set('match', null); }
    else if (message.type === 'result_pending') { setStatus(message.reason ? friendly.database_unavailable + ' Retrying result persistence…' : 'Match complete. Waiting for the server to confirm the result…'); show(); }
    else if (message.type === 'result') result(message);
    else if (message.type === 'error') { searching = false; preparing = false; setStatus(message.message === message.code ? explain(message.code) : message.message); show(); controls(); }
    else if (message.type === 'afk_warning') hud.querySelector('.online-banner').textContent = `MOVE YOUR CAR · AFK removal in ${message.seconds}s`;
    else if (message.type === 'forfeit_vote') hud.querySelector('.online-banner').textContent = `FORFEIT VOTE · ${message.votes}/${message.required}`;
    else if (message.type === 'pong') hud.querySelector('.online-network').textContent = `${reservation?.region ?? 'Server'} · ${Math.max(0, Math.round(performance.now() - message.nonce))} ms`;
    else if (['reconnect_expired', 'afk_removed'].includes(message.type)) { setStatus(explain(message.type)); show(); }
  }
  async function join(message) {
    if (matchId === message.matchId && prediction) { prediction.seq = Math.max(prediction.seq, message.ack); transport.send({ type: 'ready', matchId }); hide(); hooks.resume(); return; }
    const attempt = generation; preparing = true; reservation = message; matchId = message.matchId;
    const order = [message.self, ...message.roster.map((_, i) => i).filter(i => i !== message.self)];
    try {
      await hooks.prepare(message.roster, order, () => attempt === generation);
      if (attempt !== generation) return;
      prediction?.dispose(); prediction = new Prediction(hooks.sim, order); prediction.seq = message.ack;
      active = true; searching = false; root.classList.add('online-active'); hud.hidden = false;
      storage.set('match', { mode: message.mode, size: message.size, serverUrl: config.serverUrl });
      hud.querySelector('.online-roster').replaceChildren();
      for (const player of message.roster) { const name = document.createElement('span'); name.className = player.team === 0 ? 'blue-team' : 'orange-team'; name.textContent = player.name; hud.querySelector('.online-roster').append(name); }
      if (latestSnapshot) prediction.receive(latestSnapshot, message.self);
      transport.send({ type: 'ready', matchId });
      hide(); hooks.resume();
    } catch (error) {
      transport.send({ type: 'cancel', request }); leave(); show(); setStatus(`Could not load this match: ${error.message}`);
    } finally { preparing = false; controls(); }
  }
  function onSnapshot(snapshot) {
    latestSnapshot = snapshot; lastSnapshotAt = performance.now();
    prediction?.receive(snapshot, reservation.self);
    if (!active) return;
    Object.assign(hooks.match.state, snapshot.match);
    hud.querySelector('[data-score="blue"]').textContent = snapshot.match.blueScore;
    hud.querySelector('[data-score="orange"]').textContent = snapshot.match.orangeScore;
    const seconds = Math.ceil(snapshot.match.overtime ? snapshot.match.overtimeSeconds : snapshot.match.remainingSeconds);
    hud.querySelector('[data-clock]').textContent = `${snapshot.match.overtime ? '+' : ''}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    hud.querySelector('.online-banner').textContent = snapshot.match.phase === 'kickoff' ? String(Math.max(1, Math.ceil(snapshot.match.countdown))) : snapshot.match.phase === 'goal' ? 'GOAL!' : snapshot.match.phase === 'waiting' ? 'WAITING FOR PLAYERS' : '';
    root.dataset.onlineTick = snapshot.tick; root.dataset.onlinePhase = snapshot.match.phase;
  }
  function result(message) {
    lastResult = message; searching = false; storage.set('match', null);
    const box = find('.online-results'); box.hidden = false; box.replaceChildren();
    const title = document.createElement('h2');
    const own = reservation?.roster[reservation.self];
    title.textContent = message.status === 'cancelled' ? 'NO CONTEST' : message.winner === own?.team ? 'VICTORY' : 'DEFEAT'; box.append(title);
    const score = document.createElement('p'); score.textContent = message.status === 'cancelled' ? 'No rating change.' : `${message.blueScore} – ${message.orangeScore}`; box.append(score);
    const change = message.changes?.find(c => c.id === session?.player.id);
    if (change) {
      const badge = document.createElement('img'); badge.src = `/assets/online/ranks.svg#rank-${change.rank.badge}`; badge.alt = change.rank.name;
      const text = document.createElement('p'); text.textContent = `${change.before.mu.toFixed(0)} → ${change.after.mu.toFixed(0)} MMR (${change.delta >= 0 ? '+' : ''}${change.delta.toFixed(0)}) · ${change.rank.name}${change.rank.division ? ` Division ${change.rank.division}` : ''}`;
      box.append(badge, text);
    } else { const text = document.createElement('p'); text.textContent = message.mode === 'ranked' ? 'No eligible Ranked rating update.' : 'Casual results do not change your Ranked MMR.'; box.append(text); }
    setStatus(message.status === 'cancelled' ? explain(message.reason) : 'Result confirmed by the server.'); show(); controls();
  }
  function stopTransport() { transport?.stop(); transport = null; }
  function leave() {
    ++generation; transport?.send({ type: 'leave' }); stopTransport();
    prediction?.dispose(); prediction = null; const wasActive = active;
    active = false; searching = preparing = false; matchId = reservation = latestSnapshot = null;
    storage.set('match', null); root.classList.remove('online-active'); delete root.dataset.onlineTick; delete root.dataset.onlinePhase; hud.hidden = true;
    if (wasActive) hooks.restore();
  }
  function back() { if (active && !lastResult) { hide(); hooks.resume(); return; } leave(); hide(); hooks.home(); }
  async function signin() {
    try {
      await loadConfig();
      const client = await accountClient(config);
      storage.set('intent', { mode, size, name: input.value.trim() });
      const { error } = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: location.origin + location.pathname } });
      if (error) throw error;
    } catch (error) { setStatus(error.message); }
  }
  panel.addEventListener('click', async event => {
    const playlist = event.target.closest('[data-size]'); if (playlist) { size = Number(playlist.dataset.size); controls(); return; }
    const action = event.target.closest('[data-online]')?.dataset.online;
    if (action === 'back') back();
    else if (action === 'cancel') { ++generation; transport?.send({ type: 'cancel', request }); searching = false; stopTransport(); setStatus('Search cancelled.'); controls(); }
    else if (action === 'signin') await signin();
    else if (action === 'bots') { leave(); hide(); hooks.bots(); }
    else if (action === 'again') { leave(); lastResult = null; find('.online-results').hidden = true; await open(mode, size); await search(); }
    else if (action === 'signout') {
      try { if (session) await api('/logout', { body: {}, token: session.token }); const client = await accountClient(config); await client.auth.signOut(); }
      catch (error) { setStatus(error.message); }
      finally { leave(); session = authSession = profile = null; storage.set('session', null); input.disabled = false; controls(); }
    }
  });
  find('form').addEventListener('submit', event => { event.preventDefault(); void search(); });
  hud.querySelector('[data-forfeit]').onclick = () => transport?.send({ type: 'forfeit', matchId });
  hud.querySelector('[data-leave]').onclick = () => {
    if (mode === 'ranked' && !lastResult && !confirm('Leave this Ranked match? The result still counts and abandonment may cause a cooldown.')) return;
    leave(); hide(); hooks.home();
  };
  async function restoreIntent() {
    const intent = storage.get('intent'), pending = storage.get('match');
    const code = new URLSearchParams(location.search).get('code');
    if (intent && code) {
      hooks.closeHome(); await open(intent.mode, intent.size); input.value = intent.name || 'Player';
      try {
        const client = await accountClient(config), result = await client.auth.exchangeCodeForSession(code);
        if (result.error) throw result.error;
        authSession = result.data.session; await establishSession(); input.value = profile.name;
        storage.set('intent', null); const url = new URL(location.href); url.searchParams.delete('code'); history.replaceState(null, '', url);
        setStatus('Signed in. Your selected Ranked playlist is ready.'); controls();
      } catch (error) { setStatus(error.message); }
    } else if (pending && session) {
      hooks.closeHome(); mode = pending.mode; size = pending.size; show();
      try {
        await loadConfig(); if (config.serverUrl !== pending.serverUrl) throw Error('Your previous game server differs from this build.');
        transport = new Transport({ serverUrl: config.serverUrl, token: session.token, onMessage, onSnapshot, onState }); transport.inMatch = true; transport.connect();
      } catch (error) { setStatus(error.message); }
    }
  }
  return { open, leave, restoreIntent, get active() { return active; }, get visible() { return !panel.hidden; },
    escape: back,
    update(now, controls, clock) {
      if (!active || !prediction) return;
      const usable = transport?.connected && now - lastSnapshotAt < 1000;
      prediction.update(now, document.hidden || !document.hasFocus() || !panel.hidden ? NEUTRAL : controlsArray(controls), (seq, values) => transport?.send({ type: 'input', matchId, seq, controls: values }), clock, usable);
      hooks.match.state.paused = false;
    },
    diagnostics() { return { active, matchId, mode, size, connected: !!transport?.connected, tick: latestSnapshot?.tick ?? 0,
      phase: latestSnapshot?.match.phase, self: reservation?.self, roster: reservation?.roster?.map(p => ({ ...p })),
      authoritative: latestSnapshot ? Array.from(latestSnapshot.state) : null, acknowledgements: latestSnapshot?.acknowledgements,
      inputSequence: prediction?.seq ?? 0, pendingInputs: prediction?.pending.length ?? 0, bufferedSnapshots: prediction?.samples.length ?? 0,
      correctionUnits: prediction?.error ?? 0, result: lastResult }; },
  };
}
