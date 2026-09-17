// Finite post-deployment acceptance. Private synthetic guests only, never Ranked.
// No secrets, provider changes, artificial keepalive or background polling.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PROTOCOL } from '../src/online/protocol.js';
const site = new URL(process.env.LIVE_SITE_URL || 'https://malikahed.github.io/rocket-arena-web/');
assert.equal(site.origin, 'https://malikahed.github.io');
assert.equal(site.pathname, '/rocket-arena-web/');
const directory = 'evidence/live-release'; await mkdir(directory, { recursive: true });
const report = { checkedAt: new Date().toISOString(), site: site.href, expectedBuild: process.env.GITHUB_SHA || null,
  synthetic: true, rankedTested: false, humanInternetPlayVerified: false, checks: [], errors: [] };
let browser; const contexts = [], pages = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const configUrl = new URL('assets/online/config.json', site);
  let config;
  for (let attempt = 0; attempt < 12; attempt++) {
    configUrl.searchParams.set('release', `${process.env.GITHUB_SHA || 'check'}-${attempt}`);
    const response = await fetch(configUrl, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.ok) config = await response.json();
    if (config?.protocol === PROTOCOL && (!report.expectedBuild || config.build === report.expectedBuild)) break;
    await sleep(5000);
  }
  assert.equal(config?.protocol, PROTOCOL, 'Pages config is absent or stale');
  if (report.expectedBuild) assert.equal(config.build, report.expectedBuild, 'Pages has not published this commit');
  report.frontend = { build: config.build, protocol: config.protocol, serverUrl: config.serverUrl,
    accountsConfigured: !!(config.supabaseUrl && config.publishableKey) };
  assert.equal(config.serverUrl, 'https://rocket-arena-online-beta.onrender.com');
  report.checks.push('Actual Pages configuration identifies the deployed commit and protocol');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  report.browser = browser.version();
  async function player(name) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }); contexts.push(context);
    await context.addInitScript(() => localStorage.setItem('rocket-arena.local-graphics-presets.v1', JSON.stringify({ qualityPreset: 'potato', renderScale: .25, showStadium: false, limitFps: true, maxFps: 60 })));
    const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.errors.push(error.message));
    const url = new URL(site); url.searchParams.set('physicsDebug', '1'); url.searchParams.set('release', config.build);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.locator('.arena-home:not([hidden])').waitFor({ timeout: 90000 });
    await page.locator('[data-home="play"]').click();
    assert.equal(await page.locator('.arena-mode').count(), 4);
    return { page, name };
  }
  const a = await player('Release Check One');
  await a.page.screenshot({ path: `${directory}/main-mode-menu.png` });
  await a.page.locator('[data-home="ranked"]').click();
  await a.page.locator('.online-status').filter({ hasText: /Sign in/ }).waitFor();
  assert(await a.page.locator('[data-online="search"]').isHidden());
  if (!report.frontend.accountsConfigured) assert(await a.page.locator('[data-online="signin"]').isDisabled());
  await a.page.screenshot({ path: `${directory}/main-ranked-gate.png` });
  await a.page.locator('[data-online="back"]').click();
  await a.page.locator('[data-home="play"]').click();
  report.checks.push('Deployed Pages loads the four-mode menu and honest Ranked account gate');
  let health;
  for (let attempt = 0; attempt < 18; attempt++) {
    const response = await fetch(config.serverUrl + '/readyz', { headers: { Origin: site.origin }, signal: AbortSignal.timeout(10000) });
    health = await response.json().catch(() => ({}));
    report.backend = { status: response.status, allowOrigin: response.headers.get('access-control-allow-origin'),
      protocol: health.protocol, ready: health.ready, ranked: health.ranked, build: health.build };
    if (response.status === 403) throw Error('Backend rejects the GitHub Pages origin. Deploy the approved-origin backend fix; do not bypass CORS in the client.');
    if (response.ok && health.ready) break;
    await sleep(3000);
  }
  assert.equal(health?.ready, true, 'Backend did not become ready within the bounded cold-start check');
  assert.equal(health.protocol, PROTOCOL, 'Frontend/backend protocol mismatch');
  assert.equal(report.backend.allowOrigin, site.origin, 'Backend must allow the exact Pages origin');
  report.checks.push('Live backend is ready with compatible protocol and exact Pages CORS');
  const b = await player('Release Check Two');
  for (const p of [a,b]) {
    await p.page.locator('[data-home="casual"]').click();
    await p.page.locator('.online-status').filter({ hasText: /Choose a playlist/ }).waitFor();
    await p.page.locator('[data-size="1"]').click();
    await p.page.locator('[name="displayName"]').fill(p.name);
  }
  await a.page.locator('[data-online="create-private"]').click();
  await a.page.locator('.online-private-lobby:not([hidden])').waitFor({ timeout: 90000 });
  const code = await a.page.locator('[data-invite-code]').textContent();
  await b.page.locator('[name="inviteCode"]').fill(code);
  await b.page.locator('[data-online="join-private"]').click();
  await a.page.waitForFunction(() => !document.querySelector('[data-online="start-private"]').disabled);
  await a.page.locator('[data-online="start-private"]').click();
  for (const p of [a,b]) await p.page.waitForFunction(() => window.rocketArenaOnline?.snapshot().phase === 'playing', null, { timeout: 90000 });
  await a.page.bringToFront(); await a.page.keyboard.down('KeyW'); await sleep(2000); await a.page.keyboard.up('KeyW');
  await sleep(500);
  const states = await Promise.all([a,b].map(p => p.page.evaluate(() => window.rocketArenaOnline.snapshot())));
  assert(states.every(s => s.privateRoom && s.connected && s.authoritative[2] === 2 && s.tick > 0));
  assert.equal(states[0].matchId, states[1].matchId); assert.notEqual(states[0].self, states[1].self);
  report.clients = states.map(s => ({ self:s.self, tick:s.tick, inputSequence:s.inputSequence, netcode:s.netcode, serverTiming:s.serverTiming }));
  assert(states[0].inputSequence > 0);
  await a.page.screenshot({ path: `${directory}/main-private-gameplay.png` });
  await a.page.locator('[data-forfeit]').click();
  for (const p of [a,b]) await p.page.locator('.online-results').filter({ hasText: /Private match/ }).waitFor();
  const results = await Promise.all([a,b].map(p => p.page.evaluate(() => window.rocketArenaOnline.snapshot().result)));
  assert.equal(results[0].winner, results[1].winner); assert(results.every(r => r.changes.length === 0));
  await a.page.screenshot({ path: `${directory}/main-private-results.png` });
  for (const p of [a,b]) await p.page.locator('[data-online="back"]').click();
  report.checks.push('Two independent Internet browser clients joined one private authoritative 1v1, sent input, and received the same unrated result');
  assert.deepEqual(report.errors, []); report.success = true;
} catch (error) {
  report.success = false; report.failure = String(error); console.error(report.failure); process.exitCode = 1;
  for (const [index,page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: `${directory}/failure-${index}.png` }).catch(() => {});
} finally {
  // Closing private test clients releases their own slots; no public match/MMR was entered.
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, checks: report.checks, failure: report.failure, backend: report.backend }));
}
