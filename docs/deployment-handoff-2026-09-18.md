# Live deployment handoff — 18 September 2026

## Verified deployment state

The Pages-to-Render HTTP 403 blocker is resolved. The existing backend had remained on commit `151fa0902e04baddba5130b3e640285bc2aeab05`, while `main` and `online-play` had advanced to `5ebdfcabc99d7f7a9d73b71170d3e6d6def765d4`. Current production configuration already permits the exact Pages origin; no origin-security bypass or gameplay rewrite was necessary.

The existing Render backend was manually redeployed to `5ebdfcabc99d7f7a9d73b71170d3e6d6def765d4`. Deployment `dep-dame296k1f9s738mtevg` became live at 2026-09-18T06:59:09Z. The existing Render preview was also redeployed to the same commit; deployment `dep-dame39ad0e5s73f3dn70` became live at 2026-09-18T07:01:09Z.

- Main site: https://malikahed.github.io/rocket-arena-web/
- Backend: https://rocket-arena-online-beta.onrender.com
- Preview: https://rocket-arena-online-preview.onrender.com
- Live backend protocol: 2; native checkpoint version: 1.
- Backend native physics SHA-256: `6d92e76f35d6cd7e5df76fede54f690bdb6f0394f48cb81f3bc742871bec1992`.
- Readiness: HTTP 200; exact allowed origin: `https://malikahed.github.io`.
- Current backend advertises `ranked: false`, `capacity: 1`, `beta: true`, region Frankfurt.
- Both `main` and `online-play` remain at `5ebdfca`; no new game code was published in this continuation.
- Offline backup `offline-stable-2026-09-17` remains at `0a3571fcc0a752c7e479a5933ecc8a6bcc568598`.
- No paid plan, billing change, database, or production account was created.

## Live test evidence

The previously failed live acceptance job in the existing Pages workflow was rerun, not bypassed. It passed against the actual published Pages site and Render backend. Its prerequisite verification/deployment jobs were already successful; this continuation did not rerun the whole local 97-test suite.

- Pages workflow, now successful: https://github.com/MalikAhed/rocket-arena-web/actions/runs/35311527996
- Successful rerun job: `105511714656`.
- Artifact: https://github.com/MalikAhed/rocket-arena-web/actions/runs/35311527996/artifacts/10535708336
- Original artifact archive SHA-256: `d8ddafe258a9882fb3972e402e9eaa70229af1eb14e1cf0efa047d252aa8975f`.

A separate finite acceptance workflow was added only on `deployment-acceptance-2026-09-18`. The test runner commit was `e07aa60048fe1f363940022839ec22221a47e3c0`; the deployment under test remained `5ebdfca`.

- Workflow: https://github.com/MalikAhed/rocket-arena-web/actions/runs/35317733942
- Successful job: `105512992732`.
- Artifact: https://github.com/MalikAhed/rocket-arena-web/actions/runs/35317733942/artifacts/10535344775
- Original artifact archive SHA-256: `43a25331ed6ad7916a5d344c049f06e5a47933fedda10ee90d85f161d79b14a5`.
- Test completed at 2026-09-18T07:08:40Z with success true and no browser page errors.

| Live private test | Independent browser contexts | Result |
| --- | ---: | --- |
| 1v1 | 2 | Passed |
| 2v2 | 4 | Passed |
| 3v3 | 6 | Passed |

For every size, browser sessions loaded the actual Pages interface, created/joined a private room, entered the authoritative match, sent driving inputs, restored native checkpoints, and received the same unrated result after one full team voted to forfeit. These were short controlled matches, not five-minute full-time tests. Each test released its own slots afterward; final readiness showed zero occupied rooms.

Additional checks: allowed-origin preflight returned HTTP 204 and the exact Pages origin; a deliberately untrusted origin returned HTTP 403 without an allow-origin header. Security was not weakened to make the tests pass.

## Limitations — do not present this as competitive certification

All clients were synthetic browser contexts sharing one software-rendered GitHub Actions runner. Rendering was slow in that environment. This verifies live connectivity, input flow, native checkpoint restoration, and private-match lifecycle; it does not establish smooth frame pacing on real devices, full real-Internet packet-loss behavior, sustained hosting capacity, public matchmaking, account authentication, or account-backed Ranked persistence.

The server remains a one-concurrent-match free beta. No claim of zero stutters, complete native engine rollback, or Rocket League's exact proprietary MMR is justified. The original offline physics binary and existing deployed gameplay were not changed in this continuation.

## Remaining provider and user steps

1. Supabase is connected but the visible project list is empty. No production project exists yet. Await the user's explicit Supabase organization choice, then obtain the provider's project cost quote and complete required cost confirmation before creating anything. Do not create a paid project by assumption.
2. Render build logs reported missing Git repository access and successful fallback cloning of the public repository. This is a likely explanation for missed auto-deploys, not a completed proof of the provider's internal cause. The owner should authorize Render's GitHub app for this repository and associate the authorized Git credentials with the existing services. Preserve branch `online-play`; do not replace the services or point them to this test branch.
3. The existing backend service has an empty health-check path. Its repository blueprint specifies `/healthz`; set this in the existing service's Render dashboard Settings. The connected service tools in this session do not expose that setting.
4. After a Supabase project exists, apply the existing reviewed migrations in `server/migrations/`, check security advisers, and configure the existing backend. Database credentials belong only in private backend environment variables. The existing server requires a direct or session-pooler connection, not transaction-pooler port 6543, and verified TLS with `DATABASE_SSL=verify-full`. Do not paste passwords into chat, source, or frontend config.
5. Configure authentication and allowed redirect URLs for the actual Pages subpath. The current Supabase connector does not expose auth-provider/SMTP configuration writes. Owner login/OAuth consent, verification messages, private credentials, and any provider-only settings require the owner. Default Supabase SMTP is restricted to project-team addresses; do not claim public email signup works without appropriate email delivery or an explicitly configured supported sign-in provider.
6. Add the public Supabase URL and publishable key to the frontend's supported deployment configuration, redeploy the matching versions, and verify a real account can sign in and complete an authenticated Ranked match whose result persists. Do not put a service-role/secret key in Pages.

## Relevant provider documentation

- Render Git-provider authorization: https://render.com/docs/git-provider
- Render automatic deployments require a connected Git provider: https://render.com/docs/deploys
- Supabase database connections: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase email-delivery restrictions: https://supabase.com/docs/guides/auth/auth-smtp

The new live-modes test deliberately pins the deployed build through `LIVE_EXPECTED_BUILD`. Update that explicit value when testing a later release; do not falsify `GITHUB_SHA` or weaken assertions.
