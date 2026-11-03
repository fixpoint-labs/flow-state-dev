# realtime › it delivers over a WebSocket

**Issue:** FIX-2428
**Outcome:** On the Node host, a screen reads a change someone else made within a second, with no read between changes; a caller who may not read a session never hears of it, on the first connect or any reconnect; and wherever push can miss a change (no push, or a socket whose bus doesn't cross processes), the same screen code stays current on its timer.
**Input:** Real `serve()` hosts on bound ports over a two-action handler flow (`say`, `note`) behind a bearer-token sign-in, and real WebSocket clients: `client.subscribe` with a fetcher that adds the token, reading the session's replies (`sessions.requests`) on each change, one read at a time. Legs a and b run on FIX-2426's crossing double (`goals/lib/crossing-bus.mts`). Leg c runs once with `push: false`, and once with two hosts over one Postgres (PGlite), each on its own in-memory bus, tab 2's socket on the second. Held-out: any reply text and any session id must pass; leg a also writes in a second session T that tab 2 doesn't watch, which must not run its read.
**Signal:**
- `a:within-1s` — three replies in S, each shown by tab 2's read less than 1000 ms after it was saved (read off the host's store every 5 ms).
- `a:no-read-between` — tab 2 makes 0 reads over a 10 s window that starts after its socket's first `crosses: true` frame, with a reply in T in the middle.
- `b:control` — B reads its own reply (written from B's other device) through push.
- `b:c-never-hears` — C, who subscribes to B's session, has its handler run 0 times.
- `b:revoked` — after B's token is revoked and B's socket is dropped (its TCP socket destroyed), B's handler runs 0 more times and its read never shows the next reply.
- `c:no-push` — on a host with `push: false`, tab 2's read shows the reply less than 3000 ms (one 2 s poll interval plus 1 s) after it was saved.
- `c:second-process` — with tab 2's socket on a second process on the in-memory bus, tab 2's read shows the first process's reply less than 3000 ms after it was saved.

**Anti-game:** Not `publish` calls and not frames sent: every assertion reads what a client's own read returned (`sessions.requests`), or whether the client's handler ran at all. The socket taps (a `WebSocket` subclass that records frames) only time the start of leg a's window and floor leg c's crossing frames; they change nothing the client does. Real sockets against bound ports, not an in-process fetch. Each graded list is floored with `tell.over`; the two lists whose empty state is the claim say so. The check drives `client.subscribe`, which owns the socket and the timer; `useSubscription` is a coalesced read over it, proven by `packages/react/test/useSubscription.test.ts`.
**Model:** n/a
**Run:** `pnpm tsx goals/realtime/websocket-delivery/run.mts`
**Controls:**
- `GOAL_CONTROL=no-socket` — capabilities says push, the upgrade is never served (a scratch patch to `packages/node/src/serve.ts`). Must FAIL `a:within-1s` and `a:no-read-between`.
- `GOAL_CONTROL=skip-check` — the mint grants every session topic (a scratch patch to `packages/engine/src/push/push-delivery.ts`). Must FAIL `b:c-never-hears`.
- `GOAL_CONTROL=ignore-crossing` — the client treats every open socket as covering (a scratch patch to `packages/client/src/subscribe/push-hub.ts`). Must FAIL `c:second-process`.
- Today's `main` (the parent of this change) has no `client.subscribe` and answers the user-stream route 501, so no leg can run there; the three controls stand in for its red state.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-03 | fix/FIX-2428-subscribe (pre-commit) | n/a | PASS | a: 0 reads in 10 s idle (a reply in T included); replies shown 14, 3, 6 ms after saved · b: C's handler never ran; B read its reply 1 ms after saved; B heard nothing after revocation · c: no push, shown 1496 ms; second process (crosses: false), shown 1391 ms |
| 2026-11-03 | fix/FIX-2428-subscribe (pre-commit) | n/a | FAIL (expected) | `no-socket`: `a:no-read-between` (5 reads in 10 s), `a:within-1s` (638, 1214, 1288 ms); also `a:crossing`, `b:control` and CAN'T TELL on c's crossing frames, since nothing pushes. The first run of this control found a client defect (Node's WebSocket reports a failed handshake as an error with no close), fixed before this row |
| 2026-11-03 | fix/FIX-2428-subscribe (pre-commit) | n/a | FAIL (expected) | `skip-check`: `b:c-never-hears` only (C's handler ran 7 times) |
| 2026-11-03 | fix/FIX-2428-subscribe (pre-commit) | n/a | FAIL (expected) | `ignore-crossing`: `c:second-process` only (tab 2 never showed the reply) |
