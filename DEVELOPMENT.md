# Local development and build modes

Use Node.js 22 or newer and run commands from the repository root:

```sh
npm ci
```

The current default branch is `main`. See the [README](README.md) for the two-terminal
guest-Casual setup and account requirements. This guide distinguishes the local
frontend, production output, and checks so they are not accidentally interchanged.

## Development frontend

```sh
PORT=4173 npm start
```

`npm run dev` is the same server command. It serves `index.html`, editable
`src/` modules, and `public/` assets at `http://127.0.0.1:4173/`; it does not
start the authoritative game server. Bots and Free Play work without that backend.

The frontend port uses the first configured value from `ROCKET_ARENA_PORT`,
`CAR_SOCCER_PORT`, and `PORT`, then defaults to 4173. `HOST` defaults to
`127.0.0.1` when unset; the sample `.env` sets it to `0.0.0.0`. The sample also
sets `PORT=8080` for the backend, so override the frontend port as shown above. `ROCKET_ARENA_LIVE_RELOAD=0` disables automatic refresh.

The npm scripts read `.env` when it exists. Copy `.env.example` only for
first-time setup, and never commit credentials. Restart the development server
after environment changes; changing a file is not the same as changing the
environment of an already running process.

## Root-hosted production preview

Build without a Pages subpath, then serve the generated output:

```sh
ROCKET_ARENA_BASE_PATH= npm run build
ROCKET_ARENA_DIST=1 PORT=4173 npm start
```

These examples use POSIX shell assignments; PowerShell users can set the same
environment variables with `$env:NAME = 'value'` before the command. Keep the
preview terminal running and open `http://127.0.0.1:4173/` unless another port is
configured.

The build replaces `dist/`. Its public online configuration is generated at build
time in `dist/assets/online/config.json`. Setting a new backend URL only when
starting the production server does not rewrite that file: rebuild to change
the public configuration.

## Pages-subpath build

The Pages workflow uses:

```sh
ROCKET_ARENA_BASE_PATH=/rocket-arena-web npm run build
```

This rewrites asset URLs for a site mounted at `/rocket-arena-web/`. The local
`ROCKET_ARENA_DIST=1` server serves files at its root and does not strip that
prefix. For a root-hosted local preview, rebuild with an empty base path as above;
otherwise use a static host that actually mounts the output at the project path.

A frontend build does not deploy or update the backend. Review the actual Pages
workflow and backend release configuration before publishing.

## Choose the relevant checks

```sh
npm run verify
npm test
npm run test:online
npm run build
```

- `verify` checks protected physics binaries, asset geometry, compressed models,
  and removed-car fallback behavior.
- `test` runs the existing bot-worker regression.
- `test:online` runs the Node online suite. Database-dependent coverage needs
  `ONLINE_TEST_DATABASE_URL` pointing to a disposable test database. Report
  skips explicitly; never use real player data for this test target.
- `build` checks bundling and writes production output; it is not a browser test.

For browser integration:

```sh
npx playwright install chromium
npm run test:browser
```

The browser runner starts its own temporary backend, delay proxy, and frontend on
port 4173. Stop a manually running frontend first and clear any inherited
`ROCKET_ARENA_PORT` or `CAR_SOCCER_PORT` override so it reaches the test server.
It supports `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when an existing compatible browser
is used. CI additionally installs browser OS dependencies with `--with-deps`.

Browser evidence is written under `evidence/online-browser/`. These are synthetic
software-rendered clients; a pass does not certify account sign-in, human Internet
latency, physical-device FPS, or production capacity. For release-specific evidence
and remaining gates, read [verification](docs/online-play/VERIFICATION.md) and
[stability release](docs/online-play/STABILITY_RELEASE.md), keeping the dates of
historical reports in view.
