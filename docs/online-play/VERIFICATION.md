# Evidence and acceptance status

## Recovered integration

Repository: `MalikAhed/rocket-arena-web`; branch: `online-play`; unchanged default baseline: `0a3571fcc0a752c7e479a5933ecc8a6bcc568598`.

Integrated source/art commit: `33a1f93952ede7714347d114da022addda4ae7d4`, child of `bc1321e6aee061879ee4a8914b06e659112cb295`. Its first CI push was rejected because a job credential could not modify a workflow. The commit was subsequently recovered onto the existing branch using the authorized GitHub connector, without force-pushing. The integration patch/temporary rewrite script are removed, and the normal branch checkout contains the actual code/art. CI has read-only contents permission and no self-modifying commit step.

[Original integrated verification run](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35231266954) and [exact tested workspace/screenshots artifact](https://github.com/MalikAhed/rocket-arena-web/actions/runs/35231266954/artifacts/10501242390). That historical run's overall status is failure due to the final push; its prior tests passed. Subsequent branch/PR runs are listed in Actions and must be checked separately, not assumed successful from these historical results.

## Passing evidence for that workspace

- 26 online tests, zero failed/skipped, including real PostgreSQL: queue separation/cancellation, guest Ranked rejection, malformed/forged actions, placements and thresholds, reconnect/AFK/forfeits, transaction rollback, concurrent result retries, playlist isolation and startup lease/recovery.
- Existing bot inference regression; all three included bot models produce valid actions.
- Protected asset/native integrity verification and Pages-subpath build.
- 1v1/2v2/3v3 application tests in 2/4/6 independent browser contexts; shared server state, input handling, native goal fixture and unanimous-forfeit result.
- Browser refresh restores same match/team/car slot. Bots and Free Play work with the backend stopped and zero game-server requests during those offline checks.
- Desktop/mobile card-fit assertions, original rendered art, screenshots and zero recorded page errors.
- Both Docker images build, container startup endpoints respond, Compose YAML validates. This is not an end-to-end Compose acceptance run.
- Production dependency audit recorded zero findings at that time; not a permanent vulnerability guarantee.

Recorded environment: GitHub-hosted Linux, Node v22.23.2, Chromium 153.0.8010.12/SwiftShader, Intel Xeon Platinum 8573C. Each native arena heap measured 33,554,432 bytes. Snapshot payloads measured 816/1232/1648 bytes. The combined browser/server CI workload recorded scheduling-step maxima up to approximately 115 ms; do not interpret it as a provider or Chromebook capacity benchmark.

## Screenshots

The artifact contains `evidence/online-browser/`: `mode-menu.png`, `mode-menu-mobile.png`, `playlist-cards.png`, `account-required.png`, `matchmaking.png`, `rank-badges.png`, gameplay/goal files for each playlist, `reconnected-gameplay.png`, `results.png`, `offline-freeplay.png`, `offline-bots.png` and `report.json`. Recovered desktop menu and playlist screenshots were visually inspected. The account image is the sign-in requirement screen, not a successful live OAuth flow.

## Still not complete

No real provider project/configuration or public server deployment is implied. Live GitHub/Supabase consent, registration/recovery, browser Ranked results against that provider, full human Internet matches, sustained adverse-network tests, comprehensive aerial/flip-reset prediction quality, leak soak, full backup restore, physical touch/controllers and low-end-device performance remain unverified. Private invite rooms/parties, calibrated competitive thresholds and a durable uncommitted-result outbox are not implemented. The artwork uses the existing game meshes in original compositions; it is not pixel-identical to the older Casual/Free Play illustrations.

Synthetic clients and in-process fixtures are identified as tests. They are not evidence of human Internet play and are not provisioned as production players. Real Ranked data requires external setup plus acceptance testing. Keep this a beta until those gaps are closed.
