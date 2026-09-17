# Verification and remaining release gates

## Current verified implementation — September 17, 2026

Implementation commit: `ae12f86a299dd915c82c77e856d3b702eb0bcde2`. It preserves the concurrent result-journal commit `151fa0902e04baddba5130b3e640285bc2aeab05` and adds private rooms, cold-start handling and reconnect safeguards.

Container verification fix: `a34a6b8e95d499f02989b427b0a44dceb757c0b3`. The earlier smoke check waited only for the backend before immediately requesting the newly started frontend. The fix waits for both containers with a deadline, fails early if a container exits, preserves startup diagnostics, and checks real served configuration, the bundle and isolation headers. CI remains read-only; no application assertion was removed.

**Full successful verification:** [run 35251840744](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35251840744). [Source, screenshots and logs artifact](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35251840744/artifacts/10511355607). This is the PR integration run for head `a34a6b8e`; `evidence-commit.txt` identifies the checked-out merge commit. Later documentation-only commits do not change this tested application code. Check the newest Actions run separately rather than assuming its status.

### What passed

- **54 online tests, zero failures or skips**, including real disposable PostgreSQL. Tests cover public queue separation/cancellation, guest Ranked rejection, malformed/forged actions, rating thresholds, private-room authorization/teams/capacity/expiry/host transfer, reconnect/AFK/forfeits, atomic ratings, injected database failure, journal immutability and duplicate protection, concurrent retry/cancellation, private-result isolation, and restart/lease recovery.
- Real WebSocket private **1v1, 2v2 and 3v3** matches: distinct guest identities, lobby refresh, host-only start, full loading readiness, authoritative native state and unrated completion.
- Independent browser contexts for public **1v1, 2v2 and 3v3**: shared match identity, distinct slots, keyboard controls, a native goal fixture, refresh/reconnect and unanimous-forfeit results.
- Private **1v1 browser UI**: invite code, lowercase join, lobby refresh, host-only controls, desktop/mobile layout, abrupt socket reconnect and private result text. Server/wire coverage for private 2v2/3v3 is not a claim of browser UI coverage for those sizes.
- Simulated provider HTML 503 cold starts followed by successful readiness, bounded cancellation/retry tests, and terminal old-tab handling after session replacement.
- Existing bot regression, **236 protected-file checks**, Pages-subpath build, both Docker image builds and container startup/content checks, and the production dependency audit.
- Free Play and Bots start with the backend stopped and make **zero game-server requests** in the offline browser checks. The browser report records zero page errors.

The complete multi-service Compose deployment was not separately played end-to-end. The audit is a point-in-time result, not a permanent vulnerability guarantee.

### Evidence and interpretation

The artifact's `evidence/online-browser/` contains mode-menu desktop/mobile, playlist cards, guest account gate, matchmaking, rank badges, public gameplay/goals, refresh recovery, results, offline modes, and private waiting/ready/mobile/result screenshots, plus `report.json`. Server/database, protected assets, bots, build, containers and audit have separate evidence files. Private-room desktop/mobile/result screenshots were visually inspected; they are real browser renders, not generated gameplay images.

Browser participants are **synthetic clients**, goals are triggered by an in-process native fixture, and results are exercised through unanimous forfeits. The account screen proves the guest sign-in gate, not successful OAuth. Provider identity validation in the database test uses an injected test response, not a live Supabase account.

The environment is GitHub-hosted Ubuntu, Node 22 and Chromium/SwiftShader. Per-run reports record exact versions/CPU, native heap and snapshot sizes. These results are not a physical Chromebook, Internet-latency or production-capacity benchmark. Buffers have bounds, but this is not a long-running production leak soak.

## Still required before release

No real provider project, account configuration or public server deployment was performed in this continuation. Supabase and Render connectors respond, but workspace/organization selection and free-project cost confirmation are still required. No billing was activated.

Live GitHub/Supabase consent, registration/recovery, provider-backed Ranked results and persistence after a real deployment restart, full human Internet matches, sustained adverse-network tests, comprehensive aerial/flip-reset prediction quality, backup restoration, physical controllers/touch and low-end-device performance remain unverified. Private invite matches and the durable result journal **are implemented**; persistent parties, Ranked premades and empirically calibrated competitive thresholds are not.

A crash after journal commit is recoverable without double-awarding. An outage/process loss before the first journal write can still leave the match no-contest. Local prediction remains approximate because the native ABI does not expose complete rollback state. The rank model is Arena Team Elo v1, not Rocket League's unpublished exact MMR. Original artwork uses game meshes in new compositions and is not pixel-identical to the old Casual/Free Play cards.

Keep the PR in draft and leave `main`/its Pages deployment unchanged until the owner approves release. See `DEPLOYMENT.md` and `PRIVATE_ROOMS_AND_RECOVERY.md`.

## Historical handoff recovery

Integrated source/art commit `33a1f93952ede7714347d114da022addda4ae7d4` recovered the workspace whose original CI push failed when its job credential attempted to modify a workflow. [Historical run 35231266954](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35231266954) passed 26 online tests and the prior browser checks before that push failed. The integration was subsequently committed without force-pushing, temporary rewrite scripts were removed, and normal branch checkout contains the actual frontend/art. That old artifact is not the latest private-room implementation.
