// Finite live-deployment check. Private synthetic guests only; no Ranked,
// account creation, billing, service changes, or background keepalive.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PROTOCOL } from '../src/online/protocol.js';
import { NETWORK_CORE_SHA256 } from '../src/physics/network-core.js';
import { inspectLiveReadiness } from './live-readiness.mjs';

const site = new URL('https://malikahed.github.io/rocket-arena-web/');
const server = 'https://rocket-arena-online-beta.onrender.com';
const expectedBuild = process.env.LIVE_EXPECTED_BUILD;
assert.match(expectedBuild || '', /^[a-f0-9]{40}$/, 'Explicit deployed build is required');
const directory = 'evidence/live-modes';
await mkdir(directory, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {
  checkedAt: new Date().toISOString(), site: site.href, server,
  expectedDeployedBuild: expectedBuild, testRunnerCommit: process.env.GITHUB_SHA || null,
  synthetic: true, privateOnly: true, rankedTested: false,
  humanInternetPlayVerified: false, hardwarePerformanceCertified: false,
  limitations: ['Software-rendered Chromium clients share one GitHub-hosted runner.',
    'This is a finite connectivity and lifecycle test, not a load or zero-stutter certification.',
    'No artificial packet-loss test, account-backed Ranked test, or public matchmaking test.'],
  modes: [], errors: [], success: false,
};
let browser;
const contexts = new Set();
async function readiness() {
  const result = await inspectLiveReadiness(server, site.origin, { timeoutMs: 90000 });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.allowOrigin, site.origin);
  assert.equal(result.health.protocol, PROTOCOL);
  assert.equal(result.health.build, expectedBuild);
  assert.equal(result.health.nativeCheckpoint, 1);
  assert.equal(result.health.nativePhysics, NETWORK_CORE_SHA256);
  return result.health;
}
async function waitForFreeRoom() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const health = await readiness();
    if (health.rooms < health.capacity) return health;
    await sleep(500);
  }
  throw new Error('Live server capacity is occupied; refusing to disrupt other players');
}
async function player(size, index) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  contexts.add(context);
  await context.addInitScript(() => localStorage.setItem('rocket-arena.local-graphics-presets.v1', JSON.stringify({
    qualityPreset: 'potato', renderScale: .25, showStadium: false, limitFps: true, maxFps: 30,
  })));
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => report.errors.push({ size, index, message: error.message }));
  const url = new URL(site); url.searchParams.set('physicsDebug', '1'); url.searchParams.set('release', expectedBuild);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator('.arena-home:not([hidden])').waitFor({ timeout: 90000 });
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-home="casual"]').click();
  await page.locator('.online-status').filter({ hasText: /Choose a playlist/ }).waitFor();
  await page.locator(`[data-size="${size}"]`).click();
  await page.locator('[name="displayName"]').fill(`Live Check ${size}v${size} ${index + 1}`);
  return { page, context, index };
}
const snapshot = player => player.page.evaluate(() => window.rocketArenaOnline.snapshot());
try {
  const configResponse = await fetch(new URL(`assets/online/config.json?acceptance=${Date.now()}`, site), { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.build, expectedBuild);
  assert.equal(config.protocol, PROTOCOL);
  assert.equal(config.serverUrl, server);
  report.frontend = { build: config.build, protocol: config.protocol, accountsConfigured: !!(config.supabaseUrl && config.publishableKey) };
  report.backend = await readiness();
  const preflight = await fetch(`${server}/session`, { method: 'OPTIONS', headers: {
    Origin: site.origin, 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,authorization,x-game-session',
  }, signal: AbortSignal.timeout(15000) });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), site.origin);
  const denied = await fetch(`${server}/readyz`, { headers: { Origin: 'https://untrusted-origin.invalid' }, signal: AbortSignal.timeout(15000) });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  report.cors = { allowedOrigin: site.origin, preflightStatus: preflight.status, forbiddenOriginStatus: denied.status };
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  report.browser = browser.version();
  for (const size of [1, 2, 3]) {
    await waitForFreeRoom();
    const mode = { size, players: size * 2, startedAt: new Date().toISOString(), success: false };
    report.modes.push(mode);
    const players = [];
    try {
      for (let i = 0; i < size * 2; i++) players.push(await player(size, i));
      const host = players[0];
      await host.page.locator('[data-online="create-private"]').click();
      await host.page.locator('.online-private-lobby:not([hidden])').waitFor({ timeout: 90000 });
      const code = (await host.page.locator('[data-invite-code]').textContent()).trim();
      for (const p of players.slice(1)) {
        await p.page.locator('[name="inviteCode"]').fill(code);
        await p.page.locator('[data-online="join-private"]').click();
        await p.page.locator('.online-private-lobby:not([hidden])').waitFor();
      }
      await host.page.waitForFunction(() => !document.querySelector('[data-online="start-private"]').disabled);
      await host.page.locator('[data-online="start-private"]').click();
      await Promise.all(players.map(p => p.page.waitForFunction(() => window.rocketArenaOnline?.snapshot().phase === 'playing', null, { timeout: 90000 })));
      await Promise.all(players.map(p => p.page.keyboard.down('KeyW')));
      await sleep(5000);
      await Promise.all(players.map(p => p.page.keyboard.up('KeyW')));
      await Promise.all(players.map(p => p.page.waitForFunction(() => window.rocketArenaOnline?.snapshot().netcode?.checkpointRestores > 0, null, { timeout: 30000 })));
      const states = await Promise.all(players.map(snapshot));
      assert(states.every(s => s.privateRoom && s.connected && s.authoritative[2] === size * 2 && s.tick > 0 && s.inputSequence > 0));
      assert(states.every(s => s.netcode.nativeCheckpoint === 1 && s.netcode.checkpointRestores > 0));
      assert.equal(new Set(states.map(s => s.matchId)).size, 1);
      assert.equal(new Set(states.map(s => s.self)).size, size * 2);
      mode.matchId = states[0].matchId;
      mode.clients = states.map(s => ({ self: s.self, tick: s.tick, inputSequence: s.inputSequence, netcode: s.netcode, serverTiming: s.serverTiming }));
      await host.page.screenshot({ path: `${directory}/${size}v${size}-gameplay.png` });
      // PrivateRooms.join assigns teams alternately. Vote from all blue players,
      // not from opponents, so team-forfeit behavior is tested for each size.
      for (const p of players.filter(p => p.index % 2 === 0)) await p.page.locator('[data-forfeit]').click();
      await Promise.all(players.map(p => p.page.locator('.online-results').filter({ hasText: /Private match/ }).waitFor()));
      const results = await Promise.all(players.map(p => p.page.evaluate(() => window.rocketArenaOnline.snapshot().result)));
      assert(results.every(r => r.status === 'completed' && r.winner === 1 && r.changes.length === 0));
      assert.equal(new Set(results.map(r => r.matchId)).size, 1);
      mode.result = { matchId: results[0].matchId, winner: results[0].winner, reason: results[0].reason, rated: false, identicalForAllClients: true };
      await host.page.screenshot({ path: `${directory}/${size}v${size}-results.png` });
      for (const p of players) await p.page.locator('[data-online="back"]').click();
      mode.success = true;
      console.log(JSON.stringify({ mode: `${size}v${size}`, success: true, players: players.length, matchId: mode.matchId }));
    } finally {
      for (const p of players) { await p.context.close().catch(() => {}); contexts.delete(p.context); }
    }
  }
  report.finalBackend = await waitForFreeRoom();
  assert.deepEqual(report.errors, []);
  report.success = true;
} catch (error) {
  report.failure = String(error); process.exitCode = 1;
  console.error(report.failure);
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, modes: report.modes.map(m => ({ size: m.size, success: m.success })), failure: report.failure }));
}
