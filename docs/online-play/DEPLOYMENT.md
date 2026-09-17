# Free beta setup, backup and rollback

Official documentation reviewed **2026-09-17**. No project/service or public preview is implied by this guide. `main` and its Pages site are not deployment targets without separate approval. The root `.env.example` explains every variable; `render.yaml`, `Dockerfile` and `compose.yaml` contain the deployment templates.

## Primary approach and fallback

Use one Render Free Node game server plus Supabase Free PostgreSQL/Auth; a separate Render static site can preview the frontend while existing Pages remains untouched. `render.yaml` selects `online-play`, planned Frankfurt region, one active room and manual deploys. No region is actually deployed until the service exists. Prefer nearby database compute and measure player latency.

[Render Free](https://render.com/docs/free) is explicitly not for production: 15-minute idle sleeping, approximately one-minute wakeup, possible restarts, ephemeral filesystem and 750 shared free-instance hours. Its [free compute specification](https://render.com/docs/blueprint-spec) is 0.1 CPU/512 MB. [Hobby bandwidth](https://render.com/docs/outbound-bandwidth) includes 5 GB/month; WebSocket responses count. Attached payment methods permit overage billing; without one, exhaustion suspends service. Do not activate billing, add cards, purchase credits or upgrade. Stop if verification requires payment. No unlimited-player or production-reliability promise is made. Render Free PostgreSQL's 30-day expiration is why it is not used here.

[Supabase Free](https://supabase.com/pricing) includes 500 MB database, 50,000 monthly active auth users, 5 GB egress and at most two active projects; inactive projects pause after one week. Automatic backups are not included. Default development email delivery is not a public recovery plan. This implementation instead uses GitHub OAuth and provider-managed recovery, so it needs no custom SMTP service.

Fallback: run the supplied Compose stack on already-owned Linux hardware with durable storage. Public Internet use still needs HTTPS/WSS reverse proxy, safe origins, reliable electricity/network and backups. Hardware/operations are not automatically free. GitHub Actions, artificial keep-alives and ordinary short-lived serverless handlers are not game-server hosting substitutes.

## Exact setup steps

1. Confirm the Supabase organization and its zero-cost project estimate before creating a Free project. Retrieve its actual project URL and publishable/anon key. Never expose `sb_secret_`, service-role keys or database passwords in the frontend.
2. In the project's Connect dialog copy **direct PostgreSQL or Session pooler**, port 5432. [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres) distinguishes session from transaction mode; this server's lease cannot use transaction pooling on 6543. Copy the real pooler host, not one inferred from a region. Percent-encode the password. Set server-only `DATABASE_URL`, `DATABASE_SSL=verify-full`, and trusted `DATABASE_CA_FILE` when required. Do not append SSL URL options that override validation. Do not disable certificate checking.
3. Run `npm run db:migrate`, or apply `server/migrations/001_online.sql` through the connected migration tool to the specifically selected project. It is additive/idempotent and creates private `arena` tables. No production test users are seeded. Do not run `ONLINE_TEST_DATABASE_URL` tests against player data.
4. Configure [Supabase GitHub OAuth](https://supabase.com/docs/guides/auth/social-login/auth-github). Create a GitHub OAuth application with callback `https://PROJECT_REF.supabase.co/auth/v1/callback`. Put its client ID and secret in Supabase's provider dashboard only. The current connectors do not supply a compatible OAuth-application creation/auth-config write action; these provider-dashboard steps and consent remain user actions.
5. In Render authorize this repository and import `render.yaml` from `online-play` into NEW services. Confirm backend Free compute and no paid subscription. Keep manual deploys. Assign backend `ALLOWED_ORIGINS` to the exact actual frontend origin (no path/trailing slash), the private DB variables, public `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`, `REGION=frankfurt`, `MAX_ROOMS=1`, `MAX_CONNECTIONS=24`, `SEASON_ID=beta-1`.
6. Frontend build variables: `ONLINE_SERVER_URL=https://ACTUAL-BACKEND`, Supabase URL and publishable key. Rebuild when public config changes. A root preview leaves `ROCKET_ARENA_BASE_PATH` empty; a separately approved Pages release uses `/rocket-arena-web`.
7. Supabase Site URL/allowed redirects must include the exact frontend origin and pathname, including trailing slash. For local development additionally allow `http://127.0.0.1:4173/`. The OAuth callback to Supabase and the return URL to the game are different endpoints.
8. Validate `/readyz`, real independent browser matches, real account login/recovery and persistent Ranked results after restart. A health check alone is not acceptance. No application login or public deployment was performed during the automated CI tests.

No custom domain or DNS purchase is necessary. Keep all secrets in provider environment/secret-file controls, never chat transcripts, public config, logs or Git.

## Diagnostics and lifecycle

`/healthz` reports liveness; `/readyz` refuses new admission while database/lease startup is incomplete. Both report protocol/native hash, actual configured region and whether Ranked is configured. Deployments are beta maintenance interruptions: the replacement waits for the old exclusive lease, then unfinished matches are no-contest. Completed committed results remain. There is no seamless state migration.

Use the structured startup log, provider resource metrics and opt-in `?physicsDebug=1` / `window.rocketArenaOnline.snapshot()` diagnostics. Do not log authentication headers or the WebSocket hello token.

| Symptom | Check |
| --- | --- |
| Online unconfigured | Actual `assets/online/config.json` and frontend build variables |
| Unavailable/warming | Cold start/quota, `/readyz`, database TLS and old-server lease |
| Ranked disabled | DB, Supabase URL and public key all required |
| OAuth fails | GitHub-to-Supabase callback versus Supabase-to-game redirect; exact path |
| TLS fails | Correct hostname/CA/verify-full, no URL override |
| Search does not start | Full 2/4/6 ready roster, matching skill/region, room capacity and latency |
| Result pending | DB transaction retry; do not manually award points |

## Backup, restore and rollback

Free-tier backup is operator-owned. Before real-player maintenance, stop admission and use `pg_dump --format=custom --schema=arena --file=arena-backup.dump "$DATABASE_URL"` with verified TLS (`PGSSLMODE=verify-full`, appropriate `PGSSLROOTCERT`). Store dumps privately/encrypted; never commit them. Restore first into a separate disposable database with `pg_restore --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" arena-backup.dump` and verify profiles/history before relying on a backup. An arena-only dump does not restore Supabase Auth identities into another project: retain the original auth UUIDs/project or use a separate provider-supported identity recovery plan. These operator recovery procedures are documented, not a completed disaster-recovery test.

Rollback manually deploys a known verified `online-play` commit to both beta services. Preserve the database, committed results and immutable season configuration. Migration 001 is additive; never drop game data or reset the season to roll back code. No merge to `main` is necessary.
