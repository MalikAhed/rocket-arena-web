import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';

const out = process.env.EVIDENCE_DIR || 'evidence/baseline';
await mkdir(out, { recursive: true });
const server = spawn(process.execPath, ['tools/serve.mjs'], {
  env: { ...process.env, PORT: '4173', ROCKET_ARENA_LIVE_RELOAD: '0' }, stdio: 'inherit',
});
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch('http://127.0.0.1:4173')).ok) break; } catch {}
    if (attempt === 99) throw Error('Static server did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:4173/?physicsDebug=1', { waitUntil: 'domcontentloaded' });
  await page.locator('.arena-home:not([hidden])').waitFor({ timeout: 90000 });
  await page.screenshot({ path: `${out}/home.png` });
  await page.locator('[data-home="play"]').click();
  await page.screenshot({ path: `${out}/play.png` });
  await page.locator('[data-home="freeplay"]').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/gameplay.png` });
  await writeFile(`${out}/browser.json`, JSON.stringify({
    node: process.version, platform: os.platform(), cpu: os.cpus()[0]?.model,
    renderer: 'Chromium headless / SwiftShader (not a Chromebook benchmark)',
    browser: browser.version(), errors,
  }, null, 2));
  if (errors.length) throw Error(`Browser errors: ${errors.join('; ')}`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  if (server.exitCode === null) await once(server, 'exit');
}
