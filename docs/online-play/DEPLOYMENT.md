# Separate beta deployment: Supabase + Render

Official documentation reviewed September 17, 2026. This guide does not imply a deployed project or preview. `main` and its existing Pages site are not deployment targets without separate owner approval. `.env.example`, `render.yaml`, `Dockerfile` and `compose.yaml` contain the configuration.

## Cost and destination gate

The prepared option is one Render Free Node/WebSocket game server, Supabase Free PostgreSQL/Auth, and a separate Render static preview. The blueprint uses `online-play`, planned Frankfurt region, manual deploys and `MAX_ROOMS=1`. No region or service is actually deployed until resources exist. Prefer nearby database compute and measure real player latency; do not infer capacity from CI.

At this continuation both connectors respond. Render exposes **My Workspace** but requires the user's explicit workspace selection. Supabase exposes **malikabuallatta** but no projects. Confirm these destinations and a zero-cost project estimate before creating anything. Do not add a payment method, purchase credits, activate billing or select paid compute. Stop if the actual account/plan requires payment. Never create resources in a guessed workspace or organization.

[Render Free](https://render.com/docs/free) is a beta/testing arrangement, not a production reliability promise. Review current sleep/restart, ephemeral-storage, compute and usage constraints and [outbound bandwidth](https://render.com/docs/outbound-bandwidth) before activation; WebSocket responses consume bandwidth. Review [Supabase Free limits](https://supabase.com/pricing), inactivity pausing, quotas and backup limitations too. Do not promise unlimited players or free overages. No artificial keep-alive polling is implemented.

Fallback: use the supplied Compose stack on already-owned Linux hardware with durable storage. Public use still requires HTTPS/WSS, safe origins, reliable electricity/network and backups. Hardware/operations are not automatically free. GitHub Actions and short-lived serverless handlers are not substitutes for the authoritative game server.

## Setup sequence

1. Confirm the Supabase organization and actual **zero-cost** project estimate, then create the explicitly authorized Free project. Obtain the real project URL and publishable/legacy anon key. Never expose service-role/secret keys or database passwords in browser configuration.
2. In the project's Connect dialog obtain **direct PostgreSQL or Session pooler**, normally port 5432. Use the actual host and credentials, not a guessed region-to-host mapping. [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres) distinguishes session from transaction pooling: port 6543 transaction mode cannot hold this server's session advisory lease. Percent-encode the password. Set server-only `DATABASE_URL`, `DATABASE_SSL=verify-full`, and trusted `DATABASE_CA_FILE` when required. Do not disable certificate verification or add URL SSL options that override it.
3. Apply **all numbered migrations in order** using `npm run db:migrate`. For an authorized Supabase migration connector, apply `001_online.sql` and **`002_result_outbox.sql`**, each as a named migration, to the selected project. Applying only migration 001 is insufficient: readiness requires schema version 2 and startup needs the result journal. The migrations create private `arena` tables and no real/test player accounts. Never point `ONLINE_TEST_DATABASE_URL` at real player data.
4. Configure [Supabase GitHub OAuth](https://supabase.com/docs/guides/auth/social-login/auth-github). Create a GitHub OAuth application with callback `https://PROJECT_REF.supabase.co/auth/v1/callback`. Store the OAuth client ID/secret in Supabase's provider settings, not in source or browser configuration. The currently exposed connectors do not provide compatible OAuth-application creation/auth-configuration writes; provider-dashboard setup and consent remain user actions. Do not ask for secrets in public chat.
5. In the selected Render workspace authorize this repository and create **new** beta services from `render.yaml` on `online-play`, or use equivalent supported connector actions. Verify Free compute and manual deploys. Set backend `ALLOWED_ORIGINS` to the actual frontend HTTPS origin, with no wildcard/path/trailing slash. Set private DB variables, public `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`, `REGION=frankfurt`, `MAX_ROOMS=1`, `MAX_CONNECTIONS=24` and `SEASON_ID=beta-1`. The blueprint migrates before server startup when `DATABASE_URL` is set.
6. Build the separate frontend with actual `ONLINE_SERVER_URL=https://ACTUAL-BACKEND`, project URL and publishable key. Rebuild after public configuration changes. Leave `ROCKET_ARENA_BASE_PATH` empty for a root Render preview. Only a separately approved Pages deployment uses `/rocket-arena-web`.
7. Set Supabase Site URL and allowed redirects to the exact frontend origin/pathname, including trailing slash. For local development also allow `http://127.0.0.1:4173/`. GitHub's callback to Supabase and Supabase's return URL to the game are different endpoints. GitHub handles provider account recovery; the application does not provide its own password/SMTP reset system.
8. Run live acceptance: HTTPS/WSS, readiness, real independent players, real account login/recovery, persistent Ranked results, and restart recovery. A health response or synthetic local match alone is not acceptance. Use dedicated authorized test accounts and never seed fake public players.

## Operations and failures

`/healthz` reports liveness. `/readyz` refuses admission until database/schema/lease startup is ready. Both expose safe protocol/native-hash, region and Ranked-configuration status, not credentials. Replacement startup may remain warming while the previous process holds its exclusive lease. After acquiring it, the new process replays durably journalled outcomes, then cancels other unfinished matches as infrastructure no-contests. There is no seamless simulation migration.

Explicit online actions retry readiness for up to 90 seconds with bounded backoff and cancellation. Offline modes never wait for the game server. Waiting private lobbies expire, allocate no native arena, and do not survive restart. See `PRIVATE_ROOMS_AND_RECOVERY.md` for invitations, host transfer and result isolation.

Use structured startup logs, provider metrics and opt-in `?physicsDebug=1` / `window.rocketArenaOnline.snapshot()` diagnostics. Never log authentication headers, WebSocket hello tokens, private database URLs or OAuth secrets. Review `evidence/` from the relevant CI run; tests use disposable PostgreSQL, not the provider's player database.

| Symptom | Check |
| --- | --- |
| Server warming/unready | Schema version 2, verified TLS, database connectivity, previous process's advisory lease |
| Ranked disabled | Working DB plus correct Supabase URL/public key and real provider verification |
| OAuth fails | GitHub-to-Supabase callback versus Supabase-to-game exact allowlisted redirect |
| Browser cannot connect | Actual backend HTTPS origin, exact CORS origin and WSS deployment |
| Search waits | Full 2/4/6 human roster, skill/region rules, room capacity and latency |
| Private room cannot start | Host identity, connected full balanced teams, active-room capacity |
| Result pending | Database/journal retries; never award MMR manually |

A result becomes restart-recoverable after its first journal write commits. Database outage plus process loss before that write can still leave it no-contest. Free hosting and the journal do not guarantee uptime or protect against database data loss.

## Backup and rollback

Free-tier backup is operator-owned. Before real-player maintenance, stop admission and make an encrypted/private arena backup with verified TLS, for example:

```sh
PGSSLMODE=verify-full pg_dump --format=custom --schema=arena --file=arena-backup.dump "$DATABASE_URL"
# Configure PGSSLROOTCERT when the provider requires a trusted CA file.
```

Never commit dumps. Test recovery into a separate disposable database with `pg_restore --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" arena-backup.dump`. Verify profiles, histories and pending-result behavior before relying on a backup. An arena-only dump does not restore Supabase Auth identities into another project; preserve the original auth UUIDs/project or use the provider-supported identity recovery process. A full disaster-recovery exercise remains unverified.

For application rollback, stop new admission and deploy a previously verified compatible commit; keep manual deployment controls. Preserve additive schema/data and check compatibility before rolling back across schema versions. Do not run destructive migrations or downgrade the database automatically. `main` and its existing Pages deployment remain unchanged until separately approved.
