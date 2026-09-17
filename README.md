# Rocket Arena — online-play beta

The existing game now has server-authoritative Casual multiplayer, account-based Ranked integration, and separate offline Bots and Free Play. This is the `online-play` branch, not a replacement project. **The existing GitHub Pages site remains the default-branch edition, not a deployed online preview.** Do not merge or replace it without Malik's approval.

The integrated code and rendered artwork are committed in `33a1f93952ede7714347d114da022addda4ae7d4`. A previous CI push failed while changing a workflow; that handoff failure was recovered without a force-push. CI is read-only again. You do not need to apply an integration patch or retrieve source from an artifact.

## Start locally — guest Casual

Requires Node 22+ and npm. From a fresh clone:

```sh
git clone https://github.com/MalikAhed/rocket-arena-web.git
cd rocket-arena-web
git switch online-play
npm ci
cp .env.example .env
npm run server
```

In another terminal in the same directory:

```sh
PORT=4173 npm start
```

Open `http://127.0.0.1:4173/` in independent browser profiles. Select Play → Casual and the same playlist. You need 2, 4 or 6 ready participants for 1v1, 2v2 or 3v3. Guests need only a display name; there is no automatic bot filling. The backend defaults to port 8080, hence the explicit frontend port override. Stop the server and Bots/Free Play still work.

Without `.env`, use `PORT=8080 npm run server` and, separately, `ONLINE_SERVER_URL=http://127.0.0.1:8080 PORT=4173 ROCKET_ARENA_LIVE_RELOAD=0 npm start`. An unconfigured frontend reports that online services are unavailable rather than pretending to search.

## Durable storage and accounts

`docker compose up --build` provides a local PostgreSQL database, game server and built frontend. The named database volume persists across ordinary `docker compose down`; `down -v` deliberately destroys it. The development password in Compose is not a production credential. The Docker images and startup smoke tests passed; the complete Compose deployment still needs its own acceptance run.

Ranked requires a durable PostgreSQL connection and a real configured Supabase/GitHub OAuth provider. Configure `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, run `npm run db:migrate`, then restart the server and rebuild/restart the frontend. Never expose database credentials, OAuth secrets or Supabase secret/service-role keys in public config. The available account flow uses GitHub-managed registration/sign-in/recovery, not app-owned passwords or a development SMTP sender.

See [deployment and recovery](docs/online-play/DEPLOYMENT.md) for precise provider setup, callbacks, TLS, free limits, backups and rollback. Project creation and live OAuth/provider deployment are still external setup steps; no live multiplayer URL is claimed.

## Verification

```sh
npm run verify
npm test
npm run test:online
# Set ONLINE_TEST_DATABASE_URL to a DISPOSABLE PostgreSQL database for DB tests.
npx playwright install --with-deps chromium
npm run test:browser
npm run build
# Serve a root build locally:
ROCKET_ARENA_DIST=1 PORT=4173 npm start
```

The browser suite uses real independent browser contexts and WebSockets, but synthetic players and internal goal fixtures. It is not proof of human Internet play. [Verification evidence and remaining gaps](docs/online-play/VERIFICATION.md) distinguishes passing tests from unverified features. No Chromebook benchmark or production concurrency guarantee is claimed.

## Code and design

- `server/`: authoritative native simulation, queues, lifecycle, provider verification, PostgreSQL transactions and ratings.
- `src/online/`: shared protocol, browser transport, approximate prediction/reconciliation, authentication and UI.
- `server/migrations/001_online.sql`: private game schema and idempotent migration; no production fixture users.
- `public/assets/online/`: five rendered cards and editable original rank badges. `tools/render-online-art.mjs`, `tools/online-art-scene.js` and `tools/render-online-scenes.mjs` preserve editable sources.

Read [architecture and failure policies](docs/online-play/ARCHITECTURE.md), [the rating model](docs/online-play/RANKING.md), and [artwork provenance](docs/online-play/ARTWORK.md). Ratings are **Arena Team Elo v1, not Rocket League's exact MMR**. The supplied native API lacks full rollback state; prediction is approximate and needs high-latency competitive playtesting.

Existing car models, arena geometry, native physics constants, camera implementation, lighting, shaders and graphics presets—including Potato—are preserved. Narrow adapters add online roster/state handling. Original optimization notes are retained in [the compact-edition baseline](docs/compact-baseline.md). Existing component notices remain in `SOURCE.md`, `public/licenses/` and `public/assets/sketchfab/CREDITS.md`; this contribution grants no new blanket rights over inherited assets.
