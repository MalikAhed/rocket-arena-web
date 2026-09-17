# Negotiated native gameplay checkpoints

Date: 2026-09-17. This adds server-confirmed Soccar gameplay state to the online prediction path. It is not Rocket League's proprietary networking and **not full Bullet manifold/solver rollback**. The existing offline `rocketsim-core.wasm` remains byte-for-byte unchanged.

## Why pose-only restoration was insufficient

The prior setter constructed a new `CarState` from position, rotation and velocity plus a few inferred flags. That lost jump/flip timers, previous controls, boost timing, ball-hit state and boost-pad locks/cooldowns. Rendering a correction more softly does not fix a physics simulation restarted with the wrong jump state.

The original application wrapper and the exact pinned engine source were recovered from Malik's prior `checkpoint-03-car-soccer-ui-sunlight.zip`. That package's gameplay WASM SHA-256 matches the shipped `4d3b9c9f...` binary. The builder verifies the original wrapper hash, all 275 upstream source files, the RocketSim commit and Emscripten 4.0.10. Original RocketSim/Bullet licenses and notices apply. No game assets or proprietary Rocket League source were acquired.

`native/network-state.cpp` adds capture and atomic restoration without editing the original gameplay algorithms. It preserves exposed jump/flip/boost state, controls, contacts, hit timing, pad state, native ticks and audiovisual event counters. The parser validates every record before mutating any native object and remaps car references to the recipient's local slot order. Only the trusted server emits these checkpoints. Client messages still cannot submit positions, results or native state.

## Compatibility and rollout

The basic message contract stays at protocol 2. Its `physics` field identifies the original gameplay baseline for legacy compatibility; it is no longer a claim that every negotiated binary has that exact hash. The new core has its own SHA-256 in `src/physics/network-core.js`, the build manifest, health response and negotiated match reservation.

New clients advertise `nativeCheckpoint: 1`. A capable server advertises the matching checkpoint version/hash, then includes the bounded tagged extension in that client's snapshots. An older protocol-2 client receives only the exact original packet format. A new client connected to an older server retains the prior pose-based path. Unexpected native hashes fail closed with an update message rather than silently using a different engine.

Browsers load the extra online core only for a negotiated match. The current offline core is retained, and leaving destroys the temporary online arena, frees its bridge buffer and restores the original module. It adds roughly one native heap (initially 32 MiB) while online; it does not claim to reduce total game memory. The application still uses the original camera implementation. No offline networking or graphics preset changes are introduced.

Prediction compares acknowledgement-aligned jump/boost/button state as well as poses. Divergence restores server gameplay state before replaying outstanding inputs; visual smoothing remains separate. Pooled local hidden-state history adds 39,040 float-payload bytes to the existing 248,880-byte pose history. Both are bounded.

## Bandwidth trade-off

Checkpoint snapshots are 2,176 / 3,304 / 4,432 bytes for 1v1 / 2v2 / 3v3. At 20 snapshots/second, that is 43.52 / 66.08 / 88.64 kB/second received per client before WebSocket/TLS/IP overhead. Legacy snapshots remain 888 / 1,376 / 1,864 bytes. This is a deliberate correctness/bandwidth trade-off, not a claim that free hosting has unlimited egress or player capacity.

## Evidence

Native tests compare 1,000 ticks for 2/4/6 cars using the exact same explicit starting pose fixture in old and new cores. The upstream kickoff assigns cars from unordered storage; the same seed alone did not produce identical slot assignments after compilation changed allocation layout. The corrected test therefore equalizes initial state rather than confusing spawn-order changes with different driving algorithms.

Checkpoint capture and hidden-state roundtrips are exact for the tested fields. Published pose roundtrips permit less than 0.001 game units because conversion between published units and Bullet Float32 units is not bit-invertible. One recorded pose difference was 0.000061 units. Do not label this bit-exact full rollback.

The isolated mid-jump/double-jump fixture measured maximum position error approximately 0.00014 game units after checkpoint restore versus 44.66 with the old pose-only restore. This is one synthetic native fixture, not a percentage claim about overall Internet play or every aerial mechanic.

`tests/online/checkpoint.test.mjs` adds bounded parser tests, malformed state rejection, old/new-client socket negotiation, actual native checkpoint prediction through simulated latency/jitter/contact/aerial cases and a two-minute virtual-time six-car run. The application browser suite asserts checkpoint restoration really occurs for every 1v1/2v2/3v3 client and exercises return to offline modes. Record exact CI results before declaring any test passed.

Reproduce after building/obtaining the verified native files:

```sh
npm ci
node --test tests/netcode/native-checkpoint.mjs
npm run test:online
npm run verify
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run build
```

To rebuild from source, use `node tools/build-network-physics.mjs` inside the pinned official Emscripten 4.0.10 environment. The native manifest records all relevant hashes. Tests using the original baseline core keep using it explicitly, so adding this core does not silently rewrite the historical benchmark.

## Remaining limits

Bullet contact manifolds, solver warm-start caches and other internal dynamics caches are not serialized. Varied human collisions, flip resets, lossy/asymmetric real routes, long real-time resource soak and physical low-end devices still need acceptance testing. The existing TCP transport and free-service capacity limits remain. A smooth virtual-time trace does not prove the software-rendered CI browser ran at a playable FPS.

This feature only activates when the live backend also runs the compatible native build. Publishing Pages alone does not update Render's CORS, capacity, native build or Supabase account setup. The independent live acceptance report remains the source of truth for live functionality.
