# Main-site release and checkpoint evidence — 2026-09-17

## Approval and rollback

Malik explicitly approved updating main and the existing GitHub Pages site in this session. The old no-merge instruction in historical PR/verification notes no longer applies to this approved release. The offline version remains at branch `offline-stable-2026-09-17`, commit `0a3571fcc0a752c7e479a5933ecc8a6bcc568598`. No force push, billing activation or provider workspace selection was performed.

## Already published stability release

Main was fast-forwarded to `cf1a13eaa9df8687e9f00bcfa3914e2715e67c56` and the online frontend was successfully published at `https://malikahed.github.io/rocket-arena-web/`.

[Release run 35263529817](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35263529817): full pre-deployment verification passed, including 81/81 tests with real disposable PostgreSQL, browser multiplayer/offline regressions, protected files, bot inference and container startup. The Pages deploy job succeeded. **The separate live acceptance job failed. Do not label the overall run green.**

[Actual live-site report/screenshots](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35263529817/artifacts/10516266000) verified the exact frontend commit, online menu and honest Ranked account gate, then received HTTP403 from the backend with Origin `https://malikahed.github.io`. The live public config had no Supabase account provider. That is a precise provider-deployment blocker, not a reason to bypass CORS or fabricate Ranked.

Runtime stability fixes included a browser-valid WebSocket congestion close code, reusable prediction history, recovery after presentation suspension, GPU-wait-independent input/prediction maintenance, coalesced snapshots after server catch-up, timing diagnostics, exact approved Pages origin in the new backend code, and identifiable cached release assets. The Docker startup failure at an earlier commit was fixed by including the shared timing module; tests were not weakened.

## Native checkpoint implementation

[Implementation commit 6a08d754](https://github.com/MalikAhed/rocket-arena-web/commit/6a08d754f2bace0db0ad91e18ae939126bd7b133) contains the actual negotiated native integration. [Run 35267330474](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35267330474) completed successfully, and [its exact tested workspace/evidence](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35267330474/artifacts/10517034437) records that generated commit. Its 18 transferred source files and four generated native files were compared byte-for-byte with the locally tested versions.

Passing evidence: **91 tests, zero failed/skipped**, including the real disposable PostgreSQL suite and six native-state tests; build and protected-file verification (239 files); all three bot models; independent browser 1v1/2v2/3v3 through an ordered 80ms RTT / 20ms jitter application-message proxy; native checkpoint restoration asserted for every client; private room, refresh, abrupt reconnect, goal fixture/results and backend-stopped offline modes; both container builds/startup checks. Browser report records zero page errors.

Native equality tests compare 1,000 ticks for 2/4/6 cars from identical explicit starting poses. Mid-jump/double-jump restoration measured maximum position error 0.0001373291015625 game units with the checkpoint versus 44.66156624448829 with pose-only restoration. Hidden-state roundtrips and pad locks/cooldowns are checked. Published pose conversion permits less than 0.001 units; observed maximum field difference was 0.00006103515625. These are synthetic native fixtures, not a claim of bit-exact Bullet rollback or a percentage improvement in Internet play.

The original offline core stays unchanged. New servers and clients negotiate checkpoint version/hash; legacy protocol-2 peers retain the old wire format. New state preserves exposed jump/flip/boost/contact/pad/tick fields before input replay. It does NOT serialize Bullet solver/manifold caches. It adds an initially 32 MiB online native heap and 39,040 bytes of hidden-history float payload; checkpoint packets are 2,176 / 3,304 / 4,432 bytes. This trades memory and bandwidth for a more faithful state restoration. See `NATIVE_CHECKPOINT.md`.

## Test limits — not competitive certification

The checkpoint CI environment was Node 22.23.2, Linux, AMD EPYC 9V74, Chromium 153.0.8010.12 and SwiftShader. Test contexts selected existing Potato/user graphics settings with renderScale 0.25; product presets were not changed. Software-rendered clients were extremely slow and still recorded dropped ticks/frame intervals reaching seconds. These browser tests prove integration, NOT smooth GPU rendering, device capacity or zero stutter. Prediction maintenance does not make a slow GPU faster or prevent an OS/main-thread stall.

Separate native virtual-time tests cover 30/60/144 FPS, latency/jitter, contact/aerial and 120-second six-car runs with bounded buffers. They do not simulate every packet-level TCP retransmission, real WAN route or prolonged real-time resource leak. Human Internet play, physical target devices, live provider-backed Ranked and extensive competitive flip-reset/collision testing remain acceptance gates.

## Latest-release procedure

The main Pages workflow reruns the complete suite before each publish and then attempts live private two-client play. Consult that latest main run separately; earlier passing artifacts do not prove that the newest Pages/Render versions match. Static publication may succeed while live acceptance fails on CORS or provider availability.

The Render connector still requires explicit confirmation of workspace `My Workspace` before service actions. Supabase project listing returned no projects. The backend source now allows the exact Pages origin, but that source must actually be deployed on the existing Render service. Workspace confirmation, correct backend deployment and real Supabase/GitHub OAuth/database setup remain necessary. Do not paste private keys into chat or public repository variables.

Source-build and transfer workflows never deployed Render. A temporary hash-checked isolated-branch integration job committed only the fixed source/binary list after tests; the helper/chunks and its write permissions were removed before promotion. The permanent native reproducibility workflow and normal verification are read-only.
