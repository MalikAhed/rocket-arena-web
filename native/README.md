# Online gameplay checkpoint core

The negotiated checkpoint implementation is committed in `6a08d754f2bace0db0ad91e18ae939126bd7b133`. [Native build, complete database/network/browser/container verification](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35267330474) passed before integration. The normal workflow is now read-only and checks reproducibility; its temporary transfer helper and write-enabled job were removed.

The original application bridge was recovered from Malik's prior checkpoint-03-car-soccer-ui-sunlight.zip, whose gameplay WASM matches the current offline core's SHA-256. It is stored losslessly as bridge.cpp.gz. The builder verifies the decompressed source hash and writes bridge.cpp for ordinary editing/compilation; additive work is readable in network-state.cpp. The 275 upstream files at RocketSim revision c2baacb8f4b441dd8505e63c2aeb5a1679b60b02 are fetched from the original repository and collectively hash-checked. Existing RocketSim/Bullet licensing and README notices apply; no broader rights are asserted.

Build with the official pinned Emscripten 4.0.10 SDK using `node tools/build-network-physics.mjs`. Run `node --test tests/netcode/native-checkpoint.mjs` afterwards. Generated fingerprints are committed alongside the optional online core. The original offline binary is not replaced.

The additive capture/restore ABI preserves exposed Soccar state absent from the original pose setters: jump/flip/boost timers and flags, previous controls, wheel/contact data, ball-hit timestamps and cooldowns, pad locks/cooldowns, native tick counters and confirmed audiovisual event counters. Player-slot references are remapped; input parsing completes before any mutation. It does not serialize Bullet manifold or solver warm-start caches and must not be called complete bit-exact rollback. No physics-state upload API is exposed to players.

See [checkpoint integration and limits](../docs/online-play/NATIVE_CHECKPOINT.md) and [release evidence](../docs/online-play/RELEASE_EVIDENCE.md). A verified native build is not proof of live Render deployment, live Ranked accounts, zero stutter or competitive reliability.
