# Architecture and failure policy

## Authority and unchanged simulation

The frontend is the existing JavaScript/Three.js game. A Node process loads the same shipped RocketSim WASM, 16 arena collision meshes and shared car configurations as the browser. Its native SHA-256 remains `4d3b9c9f2c2227bc72d292fb5f294ab1f435e34b8ac8300527ee9d833a829405`. Clients send eight validated controls plus sequence numbers; the server decides poses, collisions, ball motion, goals, teams, score, clock and results. There is no client-authoritative Ranked host or client result-submission endpoint.

Simulation is 120 Hz, snapshots 20 Hz and inputs at most 60 Hz. Compact native snapshots are 816/1232/1648 bytes for 1v1/2v2/3v3, before transport overhead. Snapshot buffers cap at 24 and pending input history at 60 packets/one second. WebSocket payloads cap at 8 KiB, outbound backlog at 256 KiB; queues/connections/rooms have configured bounds. Five-second heartbeats detect a 15-second missing pong. Inputs expire to neutral after 250 ms. Browser frame rate, background tabs and local pause menus cannot stop the shared clock.

The existing camera requires local car index zero; the client explicitly permutes authoritative slots without changing identity or team. Local prediction restores exposed native poses/velocities and replays pending inputs. Remote cars and ball interpolate approximately 100 ms behind receipt. **This is not complete deterministic rollback:** the native ABI does not expose all jump, suspension and contact-cache state. Authoritative corrections remain essential; difficult aerial/flip-reset feel is not certified.

## Queues and sessions

Six public queues separate Casual/Ranked and team size. One identity may have one queue/reservation/match. Async validation cannot resurrect a cancelled search. Full human rosters must acknowledge readiness within 60 seconds; no AI replacement or human backfill is implemented. Ranked skill range starts at 100 points, expands 25 every 15 seconds, caps at 400. Casual starts at 300, expands 100, caps at 800. Teams minimize rating-sum differences. Only the configured region is advertised; measured RTT above 500 ms excludes a new match, not as evidence of cheating. Private rooms/parties are not implemented.

Guest identity uses random server-issued bearer tokens, not names; guest names are validated and inserted as text nodes. Guest sessions/casual estimates are temporary and do not survive a server restart. Accounts are Supabase-verified before Ranked queue entry and ready admission. Provider recovery is delegated to GitHub. Account ratings and history persist in PostgreSQL; browser storage is not their authority.

## Match failure policy

| Event | Policy |
| --- | --- |
| Initial loading/kickoff departure or ready timeout | No-contest, no MMR/abandonment penalty |
| Temporary disconnect during play | Neutral input; preserve slot for configurable grace (30 seconds default) |
| Reconnect before grace ends | Restore the same identity/team/car slot |
| Grace expiration | Abandoned slot, no late re-entry and no replacement bot |
| One teammate abandons | Remaining players continue; legitimate result still counts |
| Whole team abandons | Opposing team wins; simultaneous all-player tied departure may be no-contest |
| AFK | Warn at 150 seconds, remove at 180 without nonzero input |
| Forfeit | Unanimous team vote; Ranked unlocks after one minute |
| Confirmed server stall over two seconds | Infrastructure no-contest, never a cheating penalty |
| Restart/lost database lease | Cancel unfinished persisted matches; preserve committed outcomes |
| Database failure on completion | Result pending, identity remains locked; retry every three seconds |

Completed eligible Ranked abandonments receive escalating cooldowns (5/10/20/40/up to 60 minutes within 24 hours), not arbitrary extra MMR deductions. Infrastructure cancellation applies none. Uncommitted outcomes have no durable outbox: a process crash during a persistence outage can make that unfinished match no-contest after restart. This is an explicit beta reliability limitation.

## Database and operational boundaries

A session-level PostgreSQL advisory lease enforces one authoritative server process. Use direct PostgreSQL or session pooling, never transaction pooling. During replacement startup liveness can be `warming` while readiness refuses admission until the old lease is released; matches are not migrated seamlessly.

The private `arena` schema denies browser-role access and enables row-level security on game data. Parameterized queries attribute actions to the verified session. A transaction locks the match and rating rows, writes ratings/history/penalties and commits the final result together. Unique constraints and existing-result returns prevent double awards. Private, explicitly test-marked, incomplete or guest Ranked rosters are ineligible. Production exposes no test-auth shortcut.

Exact HTTPS origins, WSS, verified database TLS, schema validation and rate limits are required. Public config has only backend URL and Supabase URL/publishable key. Logs/errors must not contain tokens, credentials or player data. These safeguards are tested subsets, not an independent production security audit.
