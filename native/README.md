# Optional online gameplay checkpoint core

This branch is a tested-candidate workflow, not automatically deployed gameplay. The original offline physics binary remains unchanged.

The exact original application bridge was recovered from Malik's prior checkpoint-03-car-soccer-ui-sunlight.zip, whose gameplay WASM matches the current repository's SHA-256. It is stored losslessly as bridge.cpp.gz. The builder verifies the decompressed source hash and writes bridge.cpp for ordinary editing/compilation; new work is readable in network-state.cpp. The 275 upstream files at RocketSim revision c2baacb8f4b441dd8505e63c2aeb5a1679b60b02 are fetched from the original repository and collectively hash-checked. Existing RocketSim/Bullet licensing and README notices apply; no broader rights are asserted.

Build with Emscripten 4.0.10: `node tools/build-network-physics.mjs`. The official `emscripten/emsdk:4.0.10` container is used by the read-only verification workflow. Run `node --test tests/netcode/native-checkpoint.mjs` afterwards. The new core and fingerprint are artifacts until separately reviewed and integrated.

The additive capture/restore ABI preserves exposed Soccar state absent from the original pose setters: jump/flip/boost timers and flags, previous controls, wheel/contact data, ball-hit timestamps and cooldowns, pad locks/cooldowns, native tick counters and confirmed audiovisual event counters. Player-slot references are remapped; input parsing completes before any mutation. It does not serialize Bullet manifold or solver warm-start caches and must not be called complete bit-exact rollback. No physics-state upload API is exposed to players.

The checkpoint is a bounded Float32 payload: 24 header fields, 80 fields per car, and four fields per pad. Native 64-bit tick values are represented by four exact 16-bit components, never lossy float tick counters. Fields used only by non-Soccar modes are outside the supported scope. Tests compare unchanged baseline trajectories and checkpoint behavior; varied multiplayer contact and real-network acceptance are still required before activation.
