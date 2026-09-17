import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const out = new URL('../public/assets/online/', import.meta.url);
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, PORT: '4174', ROCKET_ARENA_LIVE_RELOAD: '0' }, stdio: 'inherit' });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:4174')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/__art', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1:4174/__art');
  await page.addScriptTag({ type: 'module', content: await readFile(new URL('./online-art-scene.js', import.meta.url), 'utf8') });
  await page.waitForFunction(() => window.onlineArtworkReady, null, { timeout: 90000 });
  await mkdir(out, { recursive: true });
  for (const kind of ['team-1', 'team-2', 'team-3', 'bots', 'ranked']) {
    const data = await page.evaluate(kind => window.renderOnlineArtwork(kind), kind);
    await writeFile(new URL(`${kind}.webp`, out), Buffer.from(data, 'base64')); console.log('Rendered original game-mesh composition:', kind);
  }
  if (errors.length) throw Error(errors.join('\n'));
} finally { await browser?.close(); server.kill('SIGTERM'); if (server.exitCode === null) await once(server, 'exit'); }
