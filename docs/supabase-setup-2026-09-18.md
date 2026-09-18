# Supabase setup handoff — 18 September 2026

## Completed actions

The owner supplied the existing project `xtfiihanffkzualgcjpi` and confirmed the Render workspace. No project or paid resource was created, no password was changed, and the offline backup was not modified.

Applied the repository's existing migrations through the connected Supabase integration:

- `20260918074040` — `rocket_arena_online` (source `server/migrations/001_online.sql`).
- `20260918074110` — `rocket_arena_result_outbox` (source `server/migrations/002_result_outbox.sql`).

Verified schema versions `[1,2]`, ten `arena` tables, Row Level Security on all ten, and no schema or table access for the browser roles `anon` and `authenticated`. The Security Advisor returned ten informational `rls_enabled_no_policy` notices, with no warning/error findings. These no-policy notices are intentional: game tables are server-only and the existing backend performs verified-account authorization. Do not add permissive browser policies to remove these notices. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Merged the project's public `SUPABASE_URL` and publishable key into both existing Render services. Set backend `DATABASE_SSL=verify-full`. Existing environment variables were preserved. No private database URL was invented or exposed.

Updated only `.github/workflows/pages.yml` on `online-play`, then fast-forwarded `main` without force to `b0470a02720368038ef33428f261c136f4b4a545`. The workflow supplies the approved public project configuration as a fallback; existing GitHub repository-variable overrides still take precedence. The added probe reports account-provider readiness separately from guest live-match acceptance. No gameplay or physics source changed.

Render automatically deployed the new commit, confirming GitHub-triggered deployment now works:

- Backend `srv-dam1r8vf3r2c73e60ob0`: deploy `dep-dament0u01pc738rbo1g`, live, trigger `new_commit`.
- Preview `srv-dam1rc7cgkoc7381cjd0`: deploy `dep-dament0u01pc738rbo90`, live, trigger `new_commit`.

## Verification

GitHub Pages workflow: https://github.com/MalikAhed/rocket-arena-web/actions/runs/35320961481

Its verification, publication, and live-acceptance jobs all succeeded. The verification suite ran 97 tests with zero failures or skips, plus independent local-browser 1v1/2v2/3v3, offline regression, container checks, and a production dependency audit.

A new finite live two-browser private 1v1 succeeded on the actual Pages site with the Render backend. Both frontend and backend identified commit `b0470a02720368038ef33428f261c136f4b4a545`. Readiness returned HTTP 200 and the exact Pages allow-origin. Both clients restored native checkpoints and received the same unrated result. No real sign-in or Ranked match was performed.

Artifacts:

- CI source and evidence: artifact `10536734815`, original ZIP SHA-256 `0574f397a4645b718d9c28867097d3975e93113a6a98808f759b971f242ede74`.
- Live screenshots and reports: artifact `10537511047`, original ZIP SHA-256 `f15ca9b08fc3829dd02e7b6901debf9db56a4656b75d38710a140c76286e916e`.
- Live report: https://github.com/MalikAhed/rocket-arena-web/actions/runs/35320961481/artifacts/10537511047

The account probe at `2026-09-18T07:50:57.219Z` returned:

```json
{
  "projectUrl": "https://xtfiihanffkzualgcjpi.supabase.co",
  "publicKeyAccepted": true,
  "githubEnabled": false,
  "backendRankedAvailable": false,
  "signInTested": false,
  "rankedMatchTested": false
}
```

A successful configuration probe is not a successful account sign-in. Ranked remains blocked. The Supabase metadata check also found zero `rocket-arena-online` database connections and zero profiles, matches, and ratings at the time of inspection.

## Dashboard actions required from the owner

### 1. Private database connection

In the existing Supabase project, choose Connect → Session pooler and copy its PostgreSQL connection string on port 5432. Replace its password placeholder privately, percent-encoding reserved password characters as needed. Use the actual supplied pooler hostname; it cannot be inferred from the region. Do not use transaction mode on port 6543, because this server holds a session-level advisory lock.

In Render's existing `rocket-arena-online-beta` service, save that full string as `DATABASE_URL`, then save/redeploy. This belongs only on the backend, never on the preview or GitHub Pages. `DATABASE_SSL=verify-full` is already set. The existing configuration rejects URL parameters beginning with `ssl`; use the application's TLS setting rather than adding `?sslmode=...` to the URL. Do not disable certificate verification to overcome a connection problem.

While in this backend's Settings, set Health Check Path to `/healthz`; it was still empty in the final service inspection. The connected tools do not expose this service setting.

Connection reference: https://supabase.com/docs/guides/database/connecting-to-postgres

### 2. GitHub sign-in

The existing game implements GitHub OAuth, not email/password signup. SMTP setup is therefore not required for this flow.

Create a GitHub OAuth App in GitHub account Settings → Developer settings → OAuth Apps. Suggested public name: `Rocket Arena Login`.

- Homepage URL: `https://malikahed.github.io/rocket-arena-web/`
- Authorization callback URL: `https://xtfiihanffkzualgcjpi.supabase.co/auth/v1/callback`

Enter that app's Client ID and Client Secret directly into Supabase Authentication → Sign In / Providers → GitHub, enable it, and save. These are OAuth app credentials, not a GitHub personal access token or repository deployment credential. Do not paste the secret into chat or commit it.

In Supabase Authentication → URL Configuration, set Site URL to `https://malikahed.github.io/rocket-arena-web/` and add this exact URL and `https://rocket-arena-online-preview.onrender.com/` to Redirect URLs. The GitHub callback goes to Supabase; the final application redirect goes to Pages or the approved preview.

References:

- https://supabase.com/docs/guides/auth/social-login/auth-github
- https://supabase.com/docs/guides/auth/redirect-urls
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app

## Next verification after owner completion

Inspect the new backend deploy for database migration/init success and verified TLS. Query actual game database connections and schema readiness, confirm GitHub provider enabled, and rerun the account probe. Then verify real OAuth sign-in and an authenticated Ranked match with durable results. Do not claim that the current guest-only success or the presence of a Supabase project establishes this. The deployment remains a testing beta; hardware frame pacing, sustained load, and competitive reliability are not certified.
