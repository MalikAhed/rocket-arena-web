import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import coreFactory from '../public/physics/rocketsim-core.js';
import { addConfiguredCar, readNativeCarConfig } from '../src/physics/car-config.js';
import { PHYSICS_PRESETS, resolveVisualHitboxFamily } from '../src/physics/presets.js';
import { STATE_LAYOUT } from '../src/physics/state-layout.js';
import { PHYSICS_SHA256, NEUTRAL, STATE_SIZE } from '../src/online/protocol.js';

// Files are loaded once; each arena owns an isolated native heap. The very
// same WASM, constructor presets and collision meshes are shipped to browsers.
let resources;
async function loadResources() {
  const wasm = await readFile(new URL('../public/physics/rocketsim-core.wasm', import.meta.url));
  if (createHash('sha256').update(wasm).digest('hex') !== PHYSICS_SHA256) throw new Error('Physics integrity check failed');
  const directory = new URL('../public/assets/arena/collision/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  if (!Array.isArray(manifest) || manifest.length !== 16 || manifest.some(name => !/^mesh_\d+\.cmf$/.test(name))) throw new Error('Invalid collision manifest');
  return { wasm, meshes: await Promise.all(manifest.map(name => readFile(new URL(name, directory)))) };
}
export class NativeArena {
  static async create(roster) {
    if (![2, 4, 6].includes(roster.length)) throw new Error('Expected two complete human teams');
    const { wasm, meshes } = await (resources ??= loadResources());
    const module = await coreFactory({ wasmBinary: wasm, print: () => {}, printErr: () => {} });
    if (module._physics_sourceVersion() !== 1) throw new Error('Unsupported native ABI');
    module._experimentalAddConfiguredCar = module._physics_addConfiguredCar;
    const data = module._malloc(meshes.reduce((sum, mesh) => sum + mesh.length, 0));
    const lengths = module._malloc(meshes.length * 4);
    try {
      let offset = data;
      meshes.forEach((mesh, index) => { module.HEAPU8.set(mesh, offset); module.HEAP32[lengths / 4 + index] = mesh.length; offset += mesh.length; });
      if (module._physics_init(data, lengths, meshes.length) !== 1 || module._physics_createArena() !== 1) throw new Error('Arena creation failed');
    } finally { module._free(data); module._free(lengths); }
    const configs = roster.map((player, index) => {
      if (addConfiguredCar(module, player.team, PHYSICS_PRESETS[resolveVisualHitboxFamily(player.visual)]) !== index) throw new Error('Invalid native slot');
      return readNativeCarConfig(module, index);
    });
    const arena = new NativeArena(module, configs);
    arena.reset();
    return arena;
  }
  constructor(module, configs) {
    this.module = module; this.configs = configs;
    this.statePtr = module._physics_getStatePtr(); this.controlsPtr = module._physics_getControlsPtr();
    if (module._physics_getStateSize() !== STATE_SIZE) throw new Error('Unsupported snapshot layout');
    this.scratch = module._malloc(51 * 4);
    module._physics_setUnlimitedBoost(0); module._physics_setGoalExplosionEnabled?.(0);
  }
  get state() { return new Float32Array(this.module.HEAPF32.buffer, this.statePtr, STATE_SIZE); }
  get ballOnGround() { return this.module._physics_getBallOnGround() === 1; }
  get heapBytes() { return this.module.HEAPU8.byteLength; }
  input(slot, values = NEUTRAL) { this.module.HEAPF32.set(values, this.controlsPtr / 4 + slot * 8); }
  step() { this.module._physics_step(1); }
  goal() { const value = this.state[STATE_LAYOUT.GOAL]; if (value) this.module._physics_clearGoalFlag(); return value; }
  reset() { this.module._physics_resetKickoff(-1); for (let i = 0; i < this.configs.length; i++) this.input(i); }
  // In-process tests use native setters to create reproducible contacts. No
  // socket/HTTP message exposes these methods or accepts client coordinates.
  setBall(values) {
    this.module.HEAPF32.fill(0, this.scratch / 4, this.scratch / 4 + 51);
    this.module.HEAPF32.set(values, this.scratch / 4);
    if (this.module._physics_setBallState(this.scratch) !== 1) throw new Error('Invalid ball fixture');
    this.module._physics_step(0);
  }
  dispose() {
    if (!this.module) return;
    this.module._free(this.scratch); this.module._physics_destroy?.();
    this.module = null; this.configs = [];
  }
}
