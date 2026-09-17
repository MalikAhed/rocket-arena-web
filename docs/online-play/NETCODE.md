# Online movement and latency — protocol v2

Implementation/research date: 2026-09-17. This is an independently implemented improvement, **not Rocket League's exact netcode**. Online-only adapters change; the native WASM, collision geometry, handling constants, camera code, graphics presets, car assets, offline Bots and Free Play are not replaced.

## What the research supports

- Rocket League's official [v1.58 notes, 2019-02-19](https://www.rocketleague.com/news/patch-notes-v1-58) describe STS/CSTS: subtle client simulation timing feedback to maintain a smooth input stream. They do not publish enough parameters/source to reproduce the complete current algorithm. Our bounded +/-2% input-clock feedback is our own configuration, not an asserted match to theirs.
- Glenn Fiedler's [State Synchronization](https://gafferongames.com/post/state_synchronization/) describes input/state synchronization, jitter buffers, immediate physics corrections and separate render-only position/orientation error decay. It explicitly describes this approach as approximate. We use these principles rather than smoothing fictional physics positions into the authoritative simulation.
- His [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/) explains buffering, velocity-aware Hermite interpolation, quaternion interpolation, and the limits of unreliable extrapolation. Our playback coordinates are server ticks, not packet arrival timestamps.
- Epic's [Networked Physics Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/networked-physics-overview) distinguishes predictive interpolation and resimulation approaches. Full rollback needs more state/history than the current shipped pose/velocity setters expose. No claim of complete internal-state rollback is made here.

## Problems corrected

The previous predictor reset its render/simulation clock whenever a snapshot arrived. That lost portions of elapsed time and made the amount of local simulation depend on packet timing. Commands were generated at most once per rendered frame; a 30 FPS client therefore sent approximately 30 commands/sec instead of the intended 60. On the server, the latest arrival overwrote earlier commands, while acknowledgements did not express partial command consumption. Snapshot arrivals were also the interpolation timestamps. Every update restored an incomplete native state and displayed its correction directly.

The new path has independent responsibilities:

1. **Simulation/input:** 120 Hz native simulation; one validated command per two simulation ticks (nominally 60 Hz). A 30 FPS frame produces two commands, not one command of ambiguous duration. Server-assigned duration prevents clients buying extra simulated time by sending more inputs.
2. **Acknowledgements/history:** snapshots include each player's current command sequence, consumed ticks (0–2), queued ticks, underflow count and applied controls. An acknowledgement retires preceding commands; deliberately discarded stale commands are retired without simulation. The client compares acknowledgement-aligned history before deciding to restore. Matching history preserves native jump/suspension internals instead of resetting them 20 times/sec.
3. **Reconciliation:** on disagreement, restore server pose/velocity state and replay only outstanding command ticks. Server-supplied remote controls replace the old neutral-input extrapolation. Hidden native state is still approximate on a restore; smoothing is not presented as a cure for that limitation.
4. **Presentation:** local rendering interpolates fixed-step states. Position and quaternion error offsets decay by elapsed time, independently of render FPS. They are never written back to authoritative or client physics. Local boost, wheel, jump and pose state share a timeline. Near-ball rendering blends toward the same predicted physics used for local contact; distant objects use buffered snapshots. This is an approximation and needs varied human playtesting, particularly challenging touches and flip resets.
5. **Remote playback:** monotonic server-tick timeline; 100–200 ms interpolation delay adjusted for measured arrival jitter; velocity-aware position interpolation and normalized quaternion interpolation. Do not blindly extrapolate cars/balls through walls when snapshots stop.
6. **Recovery:** ignore inputs from old kickoff epochs. No prediction after 300 ms without a fresh state; hold the last rendered local pose rather than jumping back to the delayed remote timeline. Restore/reconcile after a gap or authenticated reconnect. A complete outage still causes a visible freeze/correction, not magically latency-free play.

## Bounds and safety

- Input commands: maximum 32 queued server-side. Ordinary two-command bursts at 30 FPS preserve press/release edges. A backlog over six commands is compacted to the newest two; obsolete commands are discarded, never applied by speeding up server physics. This sacrifices stale button edges during a severe stall rather than replaying old steering for seconds.
- Client history: at most 60 commands / 120 replay ticks; 48 received snapshots. Render catch-up is capped at 12 ticks / 100 ms per update. Diagnostics count dropped ticks rather than hiding a slow client.
- The client input clock follows the server queue with a small, smoothed +/-2% adjustment. Authoritative simulation remains fixed at 120 Hz.
- Native state restores happen at a render boundary; multiple queued snapshots coalesce to the newest correction, avoiding repeated rollback work inside one frame.
- Old protocol clients receive `update_required`. Gameplay messages require an integer kickoff epoch. Invalid input, excess queued commands and existing rate limits cannot mutate scores, positions, clocks or ratings.
- WebSocket input congestion over 16 KiB triggers authenticated reconnect. The server skips obsolete snapshots above 16 KiB queued and retains the existing disconnect ceiling of 256 KiB. Skipping a not-yet-sent snapshot is not the same as removing an already-blocked TCP packet.
- WebSockets still use ordered reliable transport. TCP head-of-line delays during packet loss are not solved by these changes. A later datagram transport would need compatible browser/server hosting, security, congestion handling and its own evidence; no unsupported UDP-on-Render claim is made.

## Rates and wire cost

The simulation rate (120 Hz) and snapshot rate (20 Hz) are unchanged. Input timing is made consistent at nominal 60 Hz rather than raising either rate blindly.

Protocol-v2 snapshot payloads: 888 bytes for 1v1, 1,376 for 2v2, 1,864 for 3v3. At 20 snapshots/sec this is 17.76 / 27.52 / 37.28 kB/sec received per client, excluding WebSocket/TLS/IP overhead, input traffic and other messages. Six-client server fan-out is additional aggregate bandwidth, not an unlimited-capacity promise.

## Reproducing verification

```sh
npm ci
node --test tests/online/netcode.test.mjs
# Standalone before/after report (also generated by the test above):
node tests/netcode/benchmark.mjs
npm run test:online
npm run verify
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run build
```

`tests/netcode/harness.mjs` uses two independent copies of the real shipped native WASM, a deterministic placement fixture, a seeded virtual-time ordered delivery model, and synthetic controls. It checks 30/60/144 FPS command timing, 80/150 ms RTT, jitter, ball contacts, active six-car simulations, aerial/flip actions and stalled delivery. It is not a human Internet match, a packet-level TCP loss simulator, or a Chromebook benchmark.

`tests/online/browser.mjs` uses the actual application, independent browser contexts and real WebSockets through `tests/netcode/lag-proxy.mjs`. The proxy adds 40 ms in each direction plus up to 20 ms arrival jitter to application messages, preserving order. It does not model TCP retransmission, bandwidth contention or delayed WebSocket control frames. PostgreSQL tests remain real disposable-database tests in CI; they are not replaced with in-memory rating assertions.

A report must identify the exact commit, environment and passing/failed/skipped suites. A local container without database dependencies cannot claim the database test passed. Browser startup blocked by an environment policy is not a game pass or proof of gameplay failure.

## Diagnostics and coordinated rollout

`window.rocketArenaOnline.snapshot().netcode` exposes simulated/dropped ticks, correction count, skipped native restores, latest correction distance, current render offset, large snaps, jitter estimate, interpolation delay/underruns, input queue estimate, input time scale and maximum replay ticks. The existing network HUD shows RTT/jitter or an explicit paused/reconnecting state.

Both **backend and frontend must be updated together** because this changes protocol 1 to 2. Deploy the `online-play` beta backend and its separate preview frontend from the same verified commit, then reload old clients. Do not merge to `main`, replace the default Pages site, activate billing, or infer a successful live deployment from CI alone. Existing accounts/database migrations/rating parameters are unchanged by this patch.

Rollback: deploy the previous matching backend/frontend pair; avoid reverting only one side. Normal infrastructure-interrupted matches retain the existing no-contest/result-journal policy. Check `/healthz`, `/readyz` and a real two-browser match after rollout; endpoint health alone is insufficient.

## Remaining limits

True full native-state rollback, real WAN packet-loss testing, prolonged memory/performance soak, physical low-end devices and extensive competitive aerial/flip-reset playtesting remain acceptance work. A one-second loss of updates cannot be hidden without showing stale or speculative gameplay. Constant 80 ms RTT should not itself cause the old continuous clock/reconciliation jitter, but RTT alone cannot diagnose frame stalls, Wi-Fi loss, server overload or asymmetric routes.
