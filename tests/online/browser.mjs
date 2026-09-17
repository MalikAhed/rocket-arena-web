import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createLagProxy } from '../netcode/lag-proxy.mjs';
import { createGameServer } from '../../server/index.mjs';
import { configuration } from '../../server/config.mjs';

const out = 'evidence/online-browser'; await mkdir(out, { recursive: true });
const app = await createGameServer(configuration({ PORT: '0', MAX_ROOMS: '1' }));
const proxy = await createLagProxy(`http://127.0.0.1:${app.port}`, { rtt: 80, jitter: 20 });
const host = proxy.url;
const staticServer = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, PORT: '4173', ONLINE_SERVER_URL: host, ROCKET_ARENA_LIVE_RELOAD: '0' }, stdio: 'inherit' });
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 20000) { const start = performance.now(); while (!(await fn())) { if (performance.now() - start > timeout) throw Error('Browser condition timed out'); await delay(50); } }
let browser, appClosed = false;
const pages = [], errors = [], checks = [], measurements = [];
// Six GPU-rendered clients share one software-rendering CI machine. Select
// existing user settings only; do not redefine a preset or change game defaults.
const testGraphics = { qualityPreset: 'potato', renderScale: 0.25, showStadium: false, limitFps: true, maxFps: 60 };
try {
  await until(async () => { try { return (await fetch('http://127.0.0.1:4173')).ok; } catch { return false; } });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  async function newPlayer(name) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(settings => {
      localStorage.setItem('rocket-arena.local-graphics-presets.v1', JSON.stringify(settings));
    }, testGraphics);
    const page = await context.newPage(); page.setDefaultTimeout(25000); pages.push(page);
    console.log('Opening independent browser:', name);
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto('http://127.0.0.1:4173/?physicsDebug=1', { waitUntil: 'domcontentloaded' });
    await page.locator('.arena-home:not([hidden])').waitFor({ timeout: 90000 });
    return { context, page, name };
  }
  const primary = await newPlayer('Browser Player 1');
  await primary.page.locator('[data-home="play"]').click();
  const withinViewport = await primary.page.locator('.arena-mode').evaluateAll(items => items.every(item => {
    const r = item.getBoundingClientRect(), label = item.querySelector('small').getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && label.bottom <= innerHeight;
  }));
  assert(withinViewport, 'All four mode cards and their labels must fit the screen');
  await primary.page.screenshot({ path: `${out}/mode-menu.png` });
  await primary.page.setViewportSize({width: 390, height: 844});
  await primary.page.screenshot({ path: `${out}/mode-menu-mobile.png` });
  assert(await primary.page.locator('.arena-mode').evaluateAll(items => items.every(item => item.getBoundingClientRect().bottom <= innerHeight)));
  await primary.page.setViewportSize({width: 1280, height: 720});
  await primary.page.locator('[data-home="ranked"]').click();
  await primary.page.locator('.online-status').filter({ hasText: /Sign in/ }).waitFor();
  assert(await primary.page.locator('[data-online="search"]').isHidden());
  await primary.page.screenshot({ path: `${out}/account-required.png` });
  checks.push('Guest Ranked gate visible; no client-side access bypass used');
  await primary.page.locator('[data-online="back"]').click();
  const players = [primary];
  for (const size of [1, 2, 3]) {
    console.log('Testing playlist', size);
    while (players.length < size * 2) players.push(await newPlayer(`Browser Player ${players.length + 1}`));
    const current = players.slice(0, size * 2);
    for (const player of current) {
      const { page } = player;
      await page.locator('[data-home="play"]').click(); await page.locator('[data-home="casual"]').click();
      await page.locator('.online-status').filter({ hasText: /Choose a playlist/ }).waitFor();
      await page.locator(`[data-size="${size}"]`).click(); await page.locator('[name="displayName"]').fill(player.name);
      if (size === 1 && player === primary) await page.screenshot({ path: `${out}/playlist-cards.png` });
      await page.locator('[data-online="search"]').click();
      if (player === primary) {
        await page.locator('.online-status').filter({ hasText: /Searching for/ }).waitFor();
        if (size === 1) await page.screenshot({ path: `${out}/matchmaking.png` });
      }
    }
    for (const player of current) await player.page.waitForFunction(() => window.rocketArenaOnline?.snapshot().phase === 'playing', null, { timeout: 90000 });
    const reports = await Promise.all(current.map(p => p.page.evaluate(() => window.rocketArenaOnline.snapshot())));
    assert.equal(new Set(reports.map(r => r.matchId)).size, 1);
    assert.equal(new Set(reports.map(r => r.self)).size, size * 2);
    assert(reports.every(r => r.roster.length === size * 2 && r.authoritative[2] === size * 2));
    const room = app.lobby.rooms.get(reports[0].matchId);
    await primary.page.bringToFront();
    const before = room.arena.state.slice(22, 22 + size * 2 * 51);
    await primary.page.keyboard.down('KeyW'); await delay(size === 1 ? 2500 : 500); await primary.page.keyboard.up('KeyW');
    await primary.page.keyboard.down('Space'); await delay(90); await primary.page.keyboard.up('Space');
    await delay(300);
    assert.notDeepEqual(room.arena.state.slice(22, 22 + size * 2 * 51), before);
    // Server snapshots can announce playing before a GPU-delayed render. Verify
    // actual prediction in each focused client rather than sampling that race.
    for (const player of current) {
      await player.page.bringToFront();
      await player.page.waitForFunction(() => {
        const s = window.rocketArenaOnline?.snapshot();
        return s?.netcode?.protocol === 2 && s.netcode.simulatedTicks > 0;
      }, null, { timeout: 30000 });
    }
    await primary.page.bringToFront();
    const networked = await Promise.all(current.map(p => p.page.evaluate(() => window.rocketArenaOnline.snapshot())));
    assert(networked.every(r => r.netcode?.protocol === 2 && r.netcode.simulatedTicks > 0));
    assert(networked.every(r => r.netcode.nativeCheckpoint === 1 && r.netcode.checkpointRestores > 0), 'negotiated native state must actually restore in every independent client');
    assert(networked.every(r => r.pendingInputs <= 60 && r.bufferedSnapshots <= 48 && r.netcode.maxReplayTicks <= 120));
    checks.push(`${size}v${size}: protocol-v2 prediction and bounded buffers through an 80ms RTT / 20ms jitter application-message proxy`);
    await primary.page.screenshot({ path: `${out}/gameplay-${size}v${size}.png` });
    if (size === 1) {
      const oldSelf = reports[0].self;
      await primary.page.reload({ waitUntil: 'domcontentloaded' });
      await primary.page.waitForFunction(() => window.rocketArenaOnline?.snapshot().phase === 'playing', null, { timeout: 90000 });
      const reconnected = await primary.page.evaluate(() => window.rocketArenaOnline.snapshot());
      assert.equal(reconnected.matchId, room.id); assert.equal(reconnected.self, oldSelf);
      assert.equal(room.arena.state[2], 2);
      checks.push('Full browser refresh restores the same match/team/car slot');
      await primary.page.screenshot({ path: `${out}/reconnected-gameplay.png` });
    }
    // Native fixture, not a network command or a production test credential.
    room.arena.setBall([0, 5050, 110, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1800, 0, 0, 0, 0]);
    await until(() => room.match.state.blueScore + room.match.state.orangeScore > 0);
    for (const player of current) await player.page.waitForFunction(() => {
      const m = window.rocketArenaOnline?.snapshot(); return m && m.authoritative && m.phase === 'goal';
    });
    await primary.page.screenshot({ path: `${out}/goal-${size}v${size}.png` });
    const team = room.players.filter(p => p.team === 0).map(p => p.id);
    for (const player of current) {
      const identity = await player.page.evaluate(() => { const s = window.rocketArenaOnline.snapshot(); return s.roster[s.self].id; });
      if (team.includes(identity)) await player.page.locator('[data-forfeit]').click();
    }
    for (const player of current) await player.page.locator('.online-results').filter({ hasText: /VICTORY|DEFEAT/ }).waitFor();
    const completed = await Promise.all(current.map(p => p.page.evaluate(() => window.rocketArenaOnline.snapshot())));
    assert(completed.every(r => r.result.winner === 1 && r.result.matchId === room.id));
    measurements.push({ playlist: `${size}v${size}`, clients: size * 2, nativeHeapBytes: room.arena.heapBytes, snapshotBytes: room.lastSnapshotBytes,
      maxServerStepMs: app.metrics.maxStepMs, networkConditions: proxy.conditions, netcode: completed.map(r => r.netcode), clientBuffers: completed.map(r => ({ inputs: r.pendingInputs, snapshots: r.bufferedSnapshots })) });
    if (size === 1) await primary.page.screenshot({ path: `${out}/results.png` });
    checks.push(`${size}v${size}: ${size * 2} independent browser sessions, shared native state/goal, real keyboard input, unanimous-forfeit result`);
    for (const player of current) await player.page.locator('[data-online="back"]').click();
    await until(() => app.lobby.rooms.size === 0);
  }
  // Private room: real UI, independent contexts and native match; no account bypass.
  const privatePlayers = players.slice(0, 2);
  for (const player of privatePlayers) {
    await player.page.locator('[data-home="play"]').click(); await player.page.locator('[data-home="casual"]').click();
    await player.page.locator('.online-status').filter({ hasText: /Choose a playlist/ }).waitFor();
    await player.page.locator('[data-size="1"]').click();
  }
  let readinessCalls = 0;
  await primary.page.route(host + '/readyz', async route => {
    if (++readinessCalls <= 2) await route.fulfill({ status: 503, contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173' }, body: '<html>Simulated provider cold start</html>' });
    else await route.continue();
  });
  await primary.page.locator('[data-online="create-private"]').click();
  await primary.page.locator('.online-private-lobby:not([hidden])').waitFor();
  assert(readinessCalls >= 3); await primary.page.unroute(host + '/readyz');
  const inviteCode = await primary.page.locator('[data-invite-code]').textContent();
  assert(await primary.page.locator('[data-online="start-private"]').isDisabled());
  await primary.page.screenshot({ path: `${out}/private-room-waiting.png` });
  await primary.page.reload({ waitUntil: 'domcontentloaded' });
  await primary.page.locator('.online-private-lobby:not([hidden])').waitFor({ timeout: 90000 });
  assert.equal(await primary.page.locator('[data-invite-code]').textContent(), inviteCode);
  const friend = privatePlayers[1];
  await friend.page.locator('[name="inviteCode"]').fill(inviteCode.toLowerCase());
  await friend.page.locator('[data-online="join-private"]').click();
  await friend.page.locator('.online-private-lobby:not([hidden])').waitFor();
  await until(async () => await primary.page.locator('[data-online="start-private"]').isEnabled());
  assert(await friend.page.locator('[data-online="start-private"]').isHidden());
  await primary.page.screenshot({ path: `${out}/private-room-ready.png` });
  await primary.page.setViewportSize({ width: 390, height: 844 });
  await primary.page.screenshot({ path: `${out}/private-room-mobile.png` });
  assert(await primary.page.locator('.online-dialog').evaluate(e => e.scrollWidth <= e.clientWidth));
  await primary.page.setViewportSize({ width: 1280, height: 720 });
  await primary.page.locator('[data-online="start-private"]').click();
  for (const player of privatePlayers) await player.page.waitForFunction(() => window.rocketArenaOnline?.snapshot().phase === 'playing', null, { timeout: 90000 });
  const privateState = await primary.page.evaluate(() => window.rocketArenaOnline.snapshot());
  assert(privateState.privateRoom);
  const privateRoom = app.lobby.rooms.get(privateState.matchId); assert(privateRoom.private);
  // Abrupt socket loss without page refresh: the client must retry its same slot.
  const hostIdentity = privateRoom.players[privateState.self].id;
  app.lobby.peers.get(hostIdentity).ws.terminate();
  await until(async () => {
    const state = await primary.page.evaluate(() => window.rocketArenaOnline.snapshot());
    return state.connected && state.matchId === privateState.matchId && state.self === privateState.self && state.tick > privateState.tick + 90;
  });
  await primary.page.locator('[data-forfeit]').click();
  for (const player of privatePlayers) await player.page.locator('.online-results').filter({ hasText: /Private match/ }).waitFor();
  await primary.page.screenshot({ path: `${out}/private-room-result.png` });
  checks.push('Private 1v1 UI: host code, lower-case join, waiting-lobby refresh, host-only start, shared native match, abrupt socket reconnect, unrated result; desktop/mobile views');
  checks.push('Simulated Render-style HTML 503 cold start retries and reaches a ready server');
  for (const player of privatePlayers) await player.page.locator('[data-online="back"]').click();
  await until(() => app.lobby.rooms.size === 0);
  const gallery = await browser.newPage({ viewport: { width: 1100, height: 850 } }); pages.push(gallery);
  await gallery.goto('http://127.0.0.1:4173/');
  await gallery.setContent(`<body style="margin:0;background:#071c31;color:white;font:16px Arial;padding:30px"><h1>Original rank badge family</h1><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px">${Array.from({ length: 23 }, (_, i) => `<figure style="margin:0;text-align:center"><img style="width:125px;height:125px" src="http://127.0.0.1:4173/assets/online/ranks.svg#rank-${i}"><figcaption>${i ? `Tier ${i}` : 'Unranked'}</figcaption></figure>`).join('')}</div></body>`);
  await gallery.locator('img').last().waitFor(); await delay(300);
  await gallery.screenshot({ path: `${out}/rank-badges.png`, fullPage: true }); await gallery.close();
  await app.close(); appClosed = true;
  let backendRequests = 0;
  primary.page.on('request', req => { if (req.url().startsWith(host)) backendRequests++; });
  await primary.page.locator('[data-home="play"]').click(); await primary.page.locator('[data-home="freeplay"]').click();
  await delay(400); await primary.page.screenshot({ path: `${out}/offline-freeplay.png` });
  await primary.page.keyboard.press('Escape'); await primary.page.locator('[data-pause="home"]').click(); await primary.page.locator('[data-home="play"]').click(); await primary.page.locator('[data-home="match"]').click();
  await primary.page.locator('[data-match="start"]').click();
  await primary.page.locator('#match-overlay').waitFor({ state: 'hidden', timeout: 90000 });
  await delay(500); await primary.page.screenshot({ path: `${out}/offline-bots.png` });
  assert.equal(backendRequests, 0); checks.push('Free Play and Bots start while backend is stopped, without game-server requests');
  assert.equal(errors.length, 0, errors.join('\n'));
} catch (error) {
  await writeFile(`${out}/failure-diagnostics.json`, JSON.stringify({
    failure: String(error), server: app.metrics,
    clients: await Promise.all(pages.map(async page => page.isClosed() ? null : page.evaluate(() => ({
      hidden: document.hidden, focused: document.hasFocus(), online: window.rocketArenaOnline?.snapshot(),
    })).catch(() => null))),
  }, null, 2));
  for (const [index, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: `${out}/failure-${index}.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ checks, errors, measurements, node: process.version, platform: os.platform(), cpu: os.cpus()[0]?.model,
    browser: browser?.version(), renderer: 'Chromium headless SwiftShader on GitHub-hosted Linux; not a Chromebook benchmark',
    testGraphics, synthetic: true, humanInternetPlayVerified: false, liveOAuthVerified: false }, null, 2));
  await browser?.close(); await proxy.close(); if (!appClosed) await app.close(); staticServer.kill('SIGTERM');
  if (staticServer.exitCode === null) await once(staticServer, 'exit');
}
