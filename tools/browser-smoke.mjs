// Headless Chrome CDP check, using only Node's built-in WebSocket API.
import { writeFile } from 'node:fs/promises';
const endpoint = process.env.CHROME_CDP || 'http://127.0.0.1:9287';
const pages = await (await fetch(endpoint + '/json')).json();
const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [], failures = [], requests = [];
ws.addEventListener('message', ({data}) => {
  const m = JSON.parse(data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(m.error) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  if (m.method === 'Network.responseReceived') {
    const r = m.params.response;
    requests.push({url: r.url, status: r.status});
    if (r.status >= 400) failures.push({url: r.url, status: r.status});
  }
  if (m.method === 'Network.loadingFailed') failures.push(m.params);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('Chrome timeout: ' + method)); }, 120000);
  pending.set(id, {resolve: value => {clearTimeout(timer); resolve(value);}, reject: error => {clearTimeout(timer); reject(error);}});
  ws.send(JSON.stringify({id, method, params}));
});
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const waitFor = async (expression, timeout = 90000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText'));
};
try {
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', {width: 854, height: 480, deviceScaleFactor: 1, mobile: false});
  await call('Page.navigate', {url: process.env.GAME_URL || 'http://127.0.0.1:4288/'});
  await waitFor('!!document.querySelector(".arena-home:not([hidden])")');
  console.log('Home loaded', await evaluate('document.body.innerText.slice(-500)'));
  await evaluate('document.querySelector("[data-home=play]").click(); document.querySelector("[data-home=freeplay]").click()');
  await waitFor('document.querySelector(".arena-home").hidden');
  await call('Input.dispatchKeyEvent', {type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87});
  await new Promise(r => setTimeout(r, 2000));
  await call('Input.dispatchKeyEvent', {type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87});
  const screenshot = await call('Page.captureScreenshot', {format: 'png'});
  await writeFile(new URL('../gameplay-check.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  console.log('Free play loaded and received driving input.');
  await evaluate('document.querySelector("#car-button").click()');
  await waitFor('document.querySelectorAll("[data-car-status]").length === 0', 120000);
  const cars = await evaluate('[...document.querySelectorAll("[data-car-choice]")].map(e => e.dataset.carChoice)');
  if (cars.length !== 6) throw Error('Expected six garage cars');
  for (const id of cars) {
    await evaluate(`document.querySelector('[data-car-choice="${id}"]').click()`);
    await waitFor(`document.querySelector('[data-car-choice="${id}"]').classList.contains('equipped')`);
  }
  console.log('All six garage cars loaded and equipped.');
  await evaluate('document.querySelector("[data-car-close]").click(); document.querySelector("#match-button").click()');
  await evaluate('document.querySelector("[data-match=start]").click()');
  await waitFor('document.querySelector("#match-overlay").hidden', 120000);
  console.log('Bot match started.');
  await call('Emulation.setDeviceMetricsOverride', {width: 844, height: 390, deviceScaleFactor: 1, mobile: true});
  await call('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
  await call('Page.reload');
  await waitFor('!!document.querySelector(".arena-home:not([hidden])")');
  await evaluate('document.querySelector("[data-home=play]").click(); document.querySelector("[data-home=freeplay]").click()');
  await waitFor('document.querySelector(".arena-home").hidden');
  const mobile = await call('Page.captureScreenshot', {format: 'png'});
  await writeFile(new URL('../mobile-check.png', import.meta.url), Buffer.from(mobile.data, 'base64'));
  console.log('Mobile viewport loaded.');
  console.log(JSON.stringify({errors, failures, requests: requests.length}, null, 2));
  await writeFile(new URL('../browser-report.json', import.meta.url), JSON.stringify({errors, failures, requests}, null, 2));
  if (errors.length || failures.length) process.exitCode = 1;
} catch (error) {
  await writeFile(new URL('../browser-report.json', import.meta.url), JSON.stringify({checkError: String(error), errors, failures, requests}, null, 2));
  throw error;
} finally { ws.close(); }
