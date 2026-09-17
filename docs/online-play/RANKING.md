# Arena Team Elo v1 — not exact Rocket League MMR

Reference review: **2026-09-17**, current official support pages; no unverified season number. Epic's [rank structure](https://www.epicgames.com/help/c-37599050/c-Trending_0/a20928700) documents the Unranked/Bronze-through-Supersonic-Legend ladder and ordinary divisions. Its [matchmaking explanation](https://www.epicgames.com/help/c-37599050/c-32343914/rocket-league-de-eslestirme-ve-derece-sistemi-nasil-calisir-a12805879?lang=es-ES) describes progression, opponent strength, party handling and cross-playlist correction. Those sources do not disclose the complete rating formula, initial parameters, uncertainty math, thresholds and all boundary rules. This implementation therefore cannot claim exact parity.

## Implemented mathematics

Every Ranked playlist has its own rating, confidence schedule and game count. Defaults in `server/rating.mjs` are initial rating 1000, uncertainty 350, uncertainty floor 60 and 10 placement games. Ten placements is this game's explicit setting, not a separately verified private Rocket League parameter.

Team strength is the arithmetic mean of pre-match member ratings. For team A:

```
E_A = 1 / (1 + 10 ** ((mean_B - mean_A) / 400))
confidence = clamp((uncertainty - 60) / (350 - 60), 0, 1)
K = 24 + 72 * confidence
rating_new = round(max(0, rating + K * (win_indicator - E_team)), 2)
uncertainty_new = max(60, uncertainty * 0.96)
```

A new equal-rating winner/loser changes approximately +48/-48. Opponent strength changes the expectation; each teammate uses their own K. The uncertainty field is a provisional confidence schedule, not a Bayesian posterior. Mixed K values and the zero floor need not conserve rating sum. Goals/saves/scoreboard points do not affect rating. Casual uses a separate estimate and K=24, never Ranked progress.

## Boundaries, seasons and eligibility

Before ten games the badge remains Unranked. In the ordered 22-rank list, index zero starts at 0, indices 1–20 at `300 + index * 100`, and the top tier at 2400. These are our original, initially uncalibrated thresholds, not copied Rocket League numbers. Ordinary intervals have four equal divisions; the top is displayed without subtier progression, an explicit presentation choice. Exact equality enters the higher interval. There is no hidden promotion/demotion hysteresis. Post-match changes contain old/new rating, delta and old/new rank/division.

Parameters, display names and badge mappings are configurable with `RATING_CONFIG_FILE`. Persisted season configuration is immutable; changing it under the same ID refuses startup. An explicitly created new season starts fresh while retaining old history. No automatic scheduled wipe or reward system exists.

Only server-created, completed, eligible Ranked matches with full registered rosters update ratings. Offline, private/test-marked and client-declared results cannot award points. Atomic persistence and idempotency enforce once-only changes. Valid outcomes remain attributable to leavers; infrastructure no-contests do not increment ratings or placements.

Deliberate differences: team-average Elo rather than unknown party weighting, no cross-playlist anti-smurf correction, no copied season reset formula or extra first-leaver MMR deduction, approximate confidence and original thresholds. Real population calibration and competitive network playtests remain required.
