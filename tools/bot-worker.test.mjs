import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NextoAgent } from '../src/bots/nexto.js';
import { NectoAgent } from '../src/bots/necto.js';
import { SeerAgent } from '../src/bots/seer.js';

const workerPath = new URL('../public/assets/worker-iFqqV1m9.js', import.meta.url);
const source = await readFile(workerPath, 'utf8');

test('all three bots load and return valid actions through the shipped worker and WASM', { timeout: 120000 }, async () => {
  let respond;
  const context = {
    console, URL, WebAssembly, TextDecoder, TextEncoder, performance,
    setTimeout, clearTimeout, Float32Array, Uint8Array, ArrayBuffer,
    fetch: async url => {
      const path = new URL(String(url)).pathname;
      const bytes = await readFile(new URL('../public' + path, import.meta.url));
      return new Response(bytes, { headers: { 'Content-Type': path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } });
    },
    navigator: { hardwareConcurrency: 1 },
    location: { href: 'http://localhost/assets/worker-iFqqV1m9.js', origin: 'http://localhost' },
    postMessage: message => respond(message),
  };
  context.self = context;
  vm.runInNewContext(source, context, { filename: 'bot-worker.js' });
  let id = 0;
  async function send(message) {
    const reply = await new Promise(resolve => {
      respond = resolve;
      context.onmessage({ data: { ...message, id: ++id } });
    });
    assert.notEqual(reply.kind, 'error', reply.error);
    return reply;
  }
  for (const [botId, Agent, path] of [
    ['seer', SeerAgent, 'seer/'], ['necto', NectoAgent, 'necto/'], ['nexto', NextoAgent, ''],
  ]) {
    const agent = new Agent();
    const request = { botId, inputs: agent.initialInputs(), outputNames: agent.outputNames };
    const load = await send({ ...request, kind: 'load', url: `http://localhost/assets/bot/${path}policy.onnx` });
    assert.equal(load.kind, 'ready');
    const result = await send({ ...request, kind: 'decide' });
    assert.equal(result.kind, 'action');
    const controls = agent.decode(result.outputs);
    for (const [key, value] of Object.entries(controls)) {
      assert.ok(typeof value === 'boolean' || Number.isFinite(value), `${botId}: invalid ${key}`);
    }
  }
});
