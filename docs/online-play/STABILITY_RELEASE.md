# Stability pass and approved main-site release

Date: 2026-09-17. Malik explicitly approved publishing the online implementation to the existing main GitHub Pages site. The previous restriction on merging is superseded by this approval; provider billing/workspace consent is not implied. The offline snapshot is preserved at branch `offline-stable-2026-09-17`, commit `0a3571fcc0a752c7e479a5933ecc8a6bcc568598`.

## New runtime changes

The tested source integration is `03f4dc420188fc3c4b86301f811a900c59c7a570`. It preserves protocol 2, native WASM, collision geometry, car handling, visual assets and product presets. It adds:

- A browser-valid congestion close code, 4013 instead of 1013. The former code was valid on a server but throws InvalidAccessError from browser script. Congestion now enters the existing authenticated reconnect path.
- Explicit remote-playback recovery after rendering suspension. The buffer no longer remains seconds behind while trying to catch up with a tiny clock adjustment. Old epochs are rejected.
- A fixed pool of 61 two-tick command-history records (248,880 bytes of float payload), plus scratch buffers. Prediction and replay reuse those records instead of allocating a full native snapshot every tick. This reduces allocation sources; it is not proof that the entire application is allocation-free or leak-free.
- Optional online maintenance while the existing GPU fence queue is full. Input collection/prediction no longer waits for another render to complete. It does not create extra rendering, alter Potato settings, run offline connections, fix a blocked main thread, or turn a 5-FPS renderer into a 60-FPS renderer.
- Coalesced server snapshots after fixed-step catch-up. All physics ticks still run, but obsolete intermediate network snapshots are not sent in a burst after one event-loop delay.
- Bounded timing diagnostics: render frame p50/p95/p99/max, prediction CPU time, server event-loop/tick-batch timing, interpolation age/rebases and existing correction/input-buffer counters. The HUD distinguishes slow rendering from server timing problems. Measurement windows are bounded; diagnostics are not continuous DB writes.
- Invalid clock/winner snapshot metadata is rejected before it reaches rendering.

## Research and what it does not establish

[Rocket League v1.58, 2019-02-19](https://www.rocketleague.com/news/patch-notes-v1-58) documents STS/CSTS input-buffering/timing feedback. That supports a bounded feedback principle, not exact current Rocket League code or parameters.

[Riot's VALORANT consistency investigation, 2022-04-15](https://playvalorant.com/en-us/news/game-updates/valorant-gameplay-consistency-update/) explicitly discusses uneven input bursts, jitter buffering, cyclic latency adjustment and slow recovery after alt-tab frame throttling. That motivated testing suspension recovery and separating the server/input clock from presentation stalls. We do not import shooter hit-rewind behavior into this car/ball game.

[Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/) explains fixed simulation steps, rendering interpolation and overload/catch-up trade-offs. [State Synchronization](https://gafferongames.com/post/state_synchronization/) separates immediate physics correction from decaying render-only position/orientation error. These complement the prior protocol-v2 work.

The [WHATWG WebSockets Standard](https://websockets.spec.whatwg.org/#dom-websocket-close), checked 2026-09-17, restricts script-supplied close codes to 1000 or 3000–4999. A DOM-compatible regression test now catches the previous browser-only exception.

[Epic's networked physics overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/networked-physics-overview) explains history/resimulation requirements. This repository's native exports still do not expose full internal-state serialization. No full rollback or exact competitive-game parity is claimed.

## Evidence and reproduction

Run `npm ci`, `npm run verify`, `npm test`, `npm run test:online`, then `npx playwright install --with-deps chromium` and `npm run test:browser`. The database test requires a disposable `ONLINE_TEST_DATABASE_URL`. Never aim fixtures at the production database.

The new tests cover the close-code exception, a three-second presentation suspension, old epochs, parser validation, fixed telemetry windows, 24-tick snapshot coalescing, a 120-second six-car native virtual-time run, reusable-history identity checks, and a 5-FPS presentation/120-Hz-maintenance case. The latter checks that input rate survives while diagnostics still report 200-ms rendered frames. It is not a GPU speed benchmark.

The existing reproducible before/after benchmark remains in `tests/netcode/benchmark.mjs`. Pooling preserves its normal-motion measurements rather than claiming another percentage improvement. `evidence/netcode/long-session.json` reports the new soak. This soak has synthetic steering/jumping and no ball contacts in its recorded run; separate native contact/aerial and application tests remain necessary. A two-minute virtual-time test is not a long real-time memory soak or Internet test.

Full verification and live results must be attributed to their exact commit/run. A passing pre-deployment test does not imply a successful Render deploy. Local browser navigation in this chat runtime is administratively blocked; GitHub-hosted Chromium is used for browser checks instead.

## Publishing and live acceptance

Pages now invokes the read-only multiplayer/database/browser/container verification before deployment. Public build configuration defaults to the existing Render backend, accepts `ONLINE_SERVER_URL`, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` repository variables, and includes protocol/build identifiers. JS/CSS entry URLs include the commit for cache separation. Never put database or service-role credentials into those public variables.

The production backend explicitly accepts `https://malikahed.github.io` in addition to its validated configured origins. This source change must actually be deployed to Render; a frontend-only publish cannot change an older server's origin policy.

A finite post-deployment job loads the real Pages build, checks the exact frontend commit, confirms the honest Ranked gate, verifies backend CORS/protocol/readiness, then attempts a private two-client 1v1 over the Internet. The guests are synthetic, private results are unrated, and no public Ranked fixtures are created. It saves screenshots/report and fails explicitly for provider/CORS/version problems. Deployment success and live-play success are separate outcomes.

At the initial audit, Pages was offline-only, the preview configured the existing Render backend but no Supabase provider, the backend rejected the Pages origin, and the Supabase connector listed no projects. Render still required explicit workspace confirmation. These are initial observations, not permanent assumptions: consult the latest release report.

Missing accounts are shown as unavailable; no fake Ranked progress or nonfunctional sign-in button is presented as ready. Existing server-side auth, transaction safety and rating rules remain unchanged.

## Release gates still required for competitive certification

A public beta can be published without asserting zero stutter. Competitive certification requires live provider-backed registration/recovery, durable eligible Ranked results, suitable always-on capacity, real player tests across variable/asymmetric/lossy routes, target low-end devices, sustained real-time resource measurements, and difficult aerial/flip-reset/contact validation. Full native-state rollback remains outstanding. WebSocket/TCP head-of-line stalls remain possible. Render explicitly describes its [free tier](https://render.com/docs/free) as unsuitable for production; no paid upgrade is authorized by this release.

## Rollback

The preserved offline branch remains independent and runnable. For an emergency site rollback, create a new main commit whose tracked application tree is the offline snapshot rather than force-resetting shared history; keep its known Pages workflow. Restoring the offline frontend does not require deleting any database or account. For an online rollback, deploy a matching frontend/backend protocol pair and verify a real private match again. Never roll the durable ratings database back merely to revert client rendering code.

A temporary, branch-only, hash-checked integration job transferred the locally tested source after unit/database verification. It did not write main or workflow files; both its helper and write-enabled workflow were removed immediately after transfer. The normal verification and release-audit workflows are read-only; only the Pages deploy job can publish Pages.
