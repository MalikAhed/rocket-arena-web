import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { GARAGE_CARS, normalizeGarageCar } from '../src/settings/car-customization.js';
import { MeshoptDecoder } from '../src/vendor/meshopt-decoder.js';
import { NETWORK_CORE_SHA256 } from '../src/physics/network-core.js';
import { SOURCE_CORE_SHA256, ORIGINAL_GAMEPLAY_CORE_SHA256 } from '../src/physics/source-runtime.js';
const root = resolve(import.meta.dirname, '..');
const publicDir = join(root, 'public');
await MeshoptDecoder.ready;
assert.deepEqual(GARAGE_CARS.map(c => c.id), ['fennec', 'octane-original', 'challenger', 'spectre', 'vesper', 'amethyst']);
for (const id of ['tripo', 'vanguard', 'vanguard-original', 'crimson', 'volt']) assert.equal(normalizeGarageCar(id), 'fennec');
for (const [name, expected] of [['original-launch.wasm', ORIGINAL_GAMEPLAY_CORE_SHA256], ['rocketsim-core.wasm', SOURCE_CORE_SHA256], ['rocketsim-network.wasm', NETWORK_CORE_SHA256]]) {
  const bytes = await readFile(join(publicDir, 'physics', name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  assert(WebAssembly.validate(bytes));
}
const boundary = JSON.parse(gunzipSync(await readFile(join(publicDir, 'assets/arena/stadium/continuous-boundary.json.gz'))));
for (const key of ['lower', 'upper', 'goal', 'ceiling']) {
  const g = boundary[key];
  assert.equal(g.positions.length, g.normals.length);
  assert.equal(g.uv.length / 2, g.positions.length / 3);
  assert(g.indices.every(i => i >= 0 && i < g.positions.length / 3));
}
assert.equal((await stat(join(publicDir, 'assets/lighting/open-me-park.bin'))).size, 1048560);
let count = 0, total = 0;
async function visit(dir) {
  for (const e of await readdir(dir, {withFileTypes:true})) {
    const path = join(dir, e.name);
    if (e.isDirectory()) { await visit(path); continue; }
    total += (await stat(path)).size; count++;
    if (!e.name.endsWith('.glb')) continue;
    const bytes = await readFile(path), jsonSize = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
    const binary = bytes.subarray(28 + jsonSize);
    for (const view of gltf.bufferViews ?? []) {
      const m = view.extensions?.EXT_meshopt_compression;
      if (!m) continue;
      const result = new Uint8Array(m.count * m.byteStride);
      MeshoptDecoder.decodeGltfBuffer(result, m.count, m.byteStride, binary.subarray(m.byteOffset, m.byteOffset + m.byteLength), m.mode, m.filter);
    }
  }
}
await visit(publicDir);
for (const name of ['tripo', 'vanguard', 'crimson', 'volt']) {
  await assert.rejects(stat(join(publicDir, 'assets/sketchfab', name)));
}
console.log(`Verified ${count} files (${(total / 1048576).toFixed(2)} MiB), compressed models, stadium geometry, physics integrity and removed-car fallback.`);
