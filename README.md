# Rocket Arena — online play

The existing game includes authoritative Casual 1v1/2v2/3v3, account-gated Ranked, private Casual rooms, and separate offline Bots and Free Play. Malik approved publishing this version to the existing main GitHub Pages site on 2026-09-17. **This is still a beta, not a zero-stutter or competitive-reliability certification.**

The previous offline edition is preserved on `offline-stable-2026-09-17` at `0a3571fcc0a752c7e479a5933ecc8a6bcc568598`. Do not delete that rollback branch or force-push main.

## Local guest Casual

Node 22+ and npm are required:

```sh
git clone https://github.com/MalikAhed/rocket-arena-web.git
cd rocket-arena-web
git switch online-play
npm ci
cp .env.example .env
npm run server
```

In a second terminal:

```sh
PORT=4173 npm start
```

Open `http://127.0.0.1:4173/` in independent browser profiles. Casual requires 2, 4 or 6 ready human participants. Private Casual has create/join codes and host-only start. Neither queue silently adds bots. Stop the backend and Bots/Free Play remain accessible.

Without `.env`, use `PORT=8080 npm run server` and separately `ONLINE_SERVER_URL=http://127.0.0.1:8080 PORT=4173 ROCKET_ARENA_LIVE_RELOAD=0 npm start`.

## Accounts and durable Ranked

Ranked requires real Supabase/GitHub OAuth plus durable PostgreSQL. Configure `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, validated TLS and exact redirect/origin settings. Apply all numbered migrations with `npm run db:migrate`; the second migration journals authoritative outcomes for recovery and exactly-once rating application.

Never expose database passwords, service-role keys or OAuth secrets in public configuration. Accounts that are not configured are shown as unavailable, not simulated. Casual guests do not need email or passwords. The rating model is **Arena Team Elo v1, not Rocket League's exact MMR**.

See [deployment](docs/online-play/DEPLOYMENT.md), [ranking](docs/online-play/RANKING.md), [architecture](docs/online-play/ARCHITECTURE.md), and [stability release and remaining gates](docs/online-play/STABILITY_RELEASE.md). Historical deployment restrictions/status in earlier handoffs are superseded only by explicitly verified newer release evidence.

## Verification

```sh
npm run verify
npm test
npm run test:online
# Set ONLINE_TEST_DATABASE_URL to a DISPOSABLE database to include DB tests.
npx playwright install --with-deps chromium
npm run test:browser
npm run build
node tests/netcode/benchmark.mjs
```

`docker compose up --build` provides the local database/server/frontend setup. `docker compose down -v` deliberately removes its database volume; ordinary `down` does not. Do not run development fixture/seed tools against production.

The native benchmark uses independent WASM instances, seeded synthetic controls and virtual-time latency. Browser tests use independent contexts, real WebSockets and an ordered message-delay proxy. They are not human Internet play, packet-level loss simulation, Chromebook benchmarks or provider-capacity certification. Failed/skipped tests must be reported, not inferred from old passing runs.

## Main-site release

The Pages workflow runs full multiplayer/database/browser/container verification before publishing. Its build uses the actual Render backend by default and optional public repository variables `ONLINE_SERVER_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`. The deployed public config and JS/CSS URLs identify the commit. The backend must be deployed too; merging the frontend cannot update Render by itself.

A post-deploy check attempts a real private two-browser Internet match from Pages and stores its screenshots/report. **A successful static deployment is not proof that this live acceptance passed.** Check both jobs. No paid service, billing activation or workspace selection is implicit in publishing main.

## Code and preservation

`server/` owns native simulation, validated inputs, queues, lifecycle, provider verification and PostgreSQL transactions. `src/online/` implements protocol, prediction, remote interpolation, auth and UI. The stability pass adds GPU-wait-independent input maintenance, pooled prediction history, pause recovery, snapshot coalescing and timing diagnostics. See [netcode design](docs/online-play/NETCODE.md).

The native physics binary, handling constants, collision geometry, camera implementation, car/arena assets, lighting/shaders and product graphics presets are preserved. There is a narrow rendering-scheduler callback for online input maintenance; it does not redefine Potato or run offline connections. Full native internal-state rollback is not yet exposed by the shipped ABI.

Existing component notices remain in `SOURCE.md`, `public/licenses/` and asset credits. This contribution grants no new blanket rights over inherited material. Original optimization notes are retained in [the compact baseline](docs/compact-baseline.md).
