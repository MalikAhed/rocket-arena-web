import { Prediction as Before } from './baseline-v1.js';
import { Prediction as After } from '../../src/online/prediction.js';
import { InputStream } from '../../server/input-stream.mjs';
import { scenario } from './harness.mjs';
import { contactFixture, aerial, charge, opponent } from './fixtures.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
export async function compareNetcode() {
  const cases = [
    { name: '80ms-60fps', fps: 60 }, { name: '80ms-30fps', fps: 30 }, { name: '80ms-144fps', fps: 144 },
    { name: '80ms-jitter', jitter: 20 }, { name: '150ms-jitter', rtt: 150, jitter: 25 },
    { name: '80ms-stall', stall: true }, { name: 'ball-contact', setup: contactFixture, input: charge },
    { name: 'duel-contact-80-jitter', setup: contactFixture, jitter: 20, opponents: charge, input: charge },
    { name: '3v3-active-150-jitter', size: 3, rtt: 150, jitter: 25, setup: contactFixture, opponents: opponent },
    { name: 'aerial-doublejump', input: aerial }, { name: 'one-second-outage', stall: true, stallDuration: 1000 },
  ];
  const results = [];
  for (const config of cases) {
    const before = await scenario(Before, config);
    const after = await scenario(After, { ...config, streamFactory: () => new InputStream() });
    results.push({ name: config.name, before, after });
  }
  const report = { environment: { node: process.version, platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model },
    baseline: 'ae12f86a299dd915c82c77e856d3b702eb0bcde2 client and latest-input server algorithm; shared unchanged native WASM',
    metric: 'p95 norm(rendered frame displacement minus prior native velocity * frame duration), in game units. Includes acceleration/contact, not a latency or FPS measurement.',
    limitations: 'Seeded virtual-time ordered application-message delay. Synthetic controls, not humans, WAN packet loss or provider/device capacity. Synchronous receive-jump metrics are not comparable after deferred reconciliation. Long freezes increase frame residual even when maximum correction improves.', results };
  await mkdir('evidence/netcode', { recursive: true });
  await writeFile('evidence/netcode/comparison.json', JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await compareNetcode();
  console.table(report.results.map(({ name, before, after }) => ({ name, before: before.frameResidualP95, after: after.frameResidualP95, maxBefore: before.frameResidualMax, maxAfter: after.frameResidualMax })));
}
