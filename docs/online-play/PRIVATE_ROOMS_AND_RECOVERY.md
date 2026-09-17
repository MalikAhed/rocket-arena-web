# Private rooms and durable outcome recovery

Continuation on `online-play`, September 17, 2026. This supersedes the initial handoff's private-room/outbox limitations. Existing game assets, native physics, graphics presets, public queues and Arena Team Elo v1 are unchanged.

## Private rooms

Open Play > Casual. Choose 1v1/2v2/3v3 and **Create Private Room**, or enter a friend's eight-character code and **Join Room**. Codes have 40 random bits and are case-insensitive. Anyone with a valid code can occupy an available slot, so share privately. These are not Ranked parties or persistent friend groups.

The server controls membership, host identity, teams and start eligibility. Guests and accounts may join. Only the host may start, with both teams full and all members connected; the existing all-player loading/ready check still precedes kickoff. Team changes require a vacant destination slot. There is no replacement bot or backfill. Starting consumes the invitation. Private results change neither Ranked ratings/placements nor hidden Casual skill and cause no Ranked abandonment penalty.

Private and public membership share one identity lock. Waiting lobbies allocate no native arena. Defaults: `MAX_PRIVATE_LOBBIES=16`, `PRIVATE_LOBBY_TTL_SECONDS=600`; connection/queue limits still apply and active private games consume `MAX_ROOMS`. TTL is fixed from creation. Disconnect/refresh preserves the waiting-room slot for `RECONNECT_GRACE_SECONDS` (default 30). Leaving or exhausting grace frees the slot and transfers the host, preferring a connected member. Empty/expired rooms are removed. Invitations are in memory and do not survive server restart.

Names are rendered as text, not HTML. Start/team commands derive identity from the game session, not client-supplied IDs. The old browser tab treats session replacement as terminal rather than repeatedly stealing the slot back.

## Render cold starts

Only an explicit online action starts readiness retries. `/readyz` is retried for up to 90 seconds with bounded backoff and per-request timeout. Transient errors, HTML cold-start pages and warming JSON are tolerated. Cancelling or leaving stops the wait; offline modes remain independent. There is no idle polling or provider-suspension workaround, and no fake local online match.

Provider references: https://render.com/docs/free and https://render.com/docs/websocket . Free hosting remains a beta/testing arrangement, not a competitive production-service guarantee.

## Durable outcomes

Run `npm run db:migrate` before starting a database-backed server. It applies every sorted idempotent SQL migration, now including `002_result_outbox.sql`; readiness requires schema version 2. The existing Render blueprint already runs migrations before startup when `DATABASE_URL` is set.

The concurrent commit `151fa090` introduced the result journal. This continuation preserves that implementation and its security/transaction-failure tests rather than installing a second outbox.

At match end, the trusted server commits the immutable outcome to `arena.pending_results` before applying ratings. Staging locks the match; retries preserve the first committed outcome. Finalization writes ratings/history/penalties/result and removes the pending row in one transaction. Existing results return unchanged, and cancellation cannot overwrite a staged result.

After acquiring the single-process advisory lease, startup replays staged outcomes in recorded timestamp / match-ID order, then cancels other unfinished games as infrastructure no-contests. Recovery uses each match's stored season configuration. The outbox is protected in the private `arena` schema with RLS and no browser-role access. Direct PostgreSQL or Supabase session pooling remains required; transaction pooling cannot hold the lease.

**Boundary:** a crash after staging commits can recover without duplicate rating awards. A database outage or crash before staging commits can still lose an in-memory outcome and leave that game no-contest after restart. This is not protection against database data loss, seamless simulation migration or guaranteed free-host uptime. There is no client result-submission API.

## Verification and provider state

Added tests cover private-room authorization, capacity/expiry/teams, real WebSocket private 1v1/2v2/3v3, refresh and ready checks, immutable staged results and startup replay, HTML cold starts, cancellation and tab replacement. Browser coverage adds host/guest controls, lowercase codes, waiting-room refresh, abrupt socket reconnect, unrated results and desktop/mobile screenshots. Existing public matches, offline regression, assets, database and containers remain in CI.

Local dependency-free tests passed before submission. Consult the current commit's Actions run for the full PostgreSQL/browser/container result. Synthetic clients and native fixtures are not human Internet matches, live OAuth, adverse-network gameplay certification or production capacity testing.

Both provider connectors respond. Render exposes **My Workspace** and requires the user's selection before service actions. Supabase exposes organization **malikabuallatta** but **no projects**. No Supabase project/migration, Render service, paid plan, billing activation or live endpoint was created in this continuation. Organization/workspace selection and project cost confirmation are still required; OAuth/provider credentials and private database connection settings require secure configuration. Never commit secrets or paste them into chat.

`main` and its existing GitHub Pages deployment are unchanged. Draft PR #1 remains the integration review.
