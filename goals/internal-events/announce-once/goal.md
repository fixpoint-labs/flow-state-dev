# internal-events › it announces once

**Issue:** FIX-2630 (epic FIX-2471)
**Outcome:** A session that learns something announces it once, on a declared topic, and every routine of the same user that follows the topic hears it once, from `service:internal`, as information. The publisher names nobody and learns nobody who heard. A misspelt topic is refused at publish and at follow. The publishing session never hears itself; a teammate and another org hear nothing (own-user first). Two routines announcing to each other stop at the message budget, and three routines that each pass a topic on share that one budget.
**Input:** `fixtures/fixture.json`: 2 users in one org (`alice`, `bob`) and a third in another (`carol`); 5 topics; 5 routines on 2 topics (the publisher's own session on `deploy.finished`, one alice routine hearing only `failed`, one on `report.ready`, the teammate's and the other org's on `deploy.finished`); 4 publishes from alice's `eng.watcher` session; 1 ring of 2 routines (`ring.ping` ↔ `ring.pong`); 1 topic (`fan.out`) with 3 routines that each pass it on; a budget of 6. Held-out: the expected deliveries per routine come from an oracle in `run.mts` that restates the spec's rules (topic, kinds, own user, not the publishing session) over the fixture and imports no routing code, so a different valid fixture must still pass a correct implementation.
**Signal:** All of them, on one run, through the real dispatch seam and `routeServiceEvent` (no direct route call anywhere in the run):
- **(a)** each routine's message-log rows from `service:internal` equal the oracle's set of published events exactly, and all 4 publishes were accepted;
- **(b)** 0 rows in the publishing session, though it follows the topic it published on;
- **(c)** 0 rows to the teammate and 0 to the other org, though both follow the topic;
- **(d)** the undeclared topic is refused twice, at publish (`no_topic`, naming the declared topics) and at follow (`no_topic`); an input that names a `sender` fails the schema (`invalid_input`);
- **(e)** the ring: exactly one refusal, by a turn at hop 6, with the budget's reason; 5 passes; its 6 deliveries at hops 1..6;
- **(f)** 0 task rows, 0 rows asking a reply, and every publish result is `{ published }` or `{ refused }`, nothing else;
- **(g)** the fan-out's paid places, summed over every chain row it made, never pass the budget, all in one chain row; every pass past it refused with the budget's reason;
- and 0 model resolutions.

**Anti-game:** a hollow pass would count route calls or owner runs fired, or read the publish's own answer as proof someone heard. The check reads stored message-log rows (per session, by the event id in the row's id) and the chain rows, and the publish outcomes only for refusals and the result shape. The routes are never called by the run: every event enters through a block's `publishEvent` and the seam. Each list an assertion grades is floored with `tell.over`, and the empty ones say why empty is the claim. The relay turns publish with no model: each ring or fan session's turn on what it heard publishes its fixture pass, so the ring and the fan-out run the real woken-turn path (`onMessageReceived` at the delivery's hop and chain).
**Model:** n/a (model-free: no generator or evaluator is on this path, and the run asserts it)
**Run:** `pnpm tsx goals/internal-events/announce-once/run.mts`
**Controls:**
- `GOAL_CONTROL=owner-run-hop` places a published event's delivery as GitHub's is placed: at the owner run's hop, in the owner run's chain or a new one. Must FAIL **(e)**: the ring runs to the subscriptions' hourly cap. **(g)** fails with it, of the same cause (each delivery starts a new chain).
- `GOAL_CONTROL=free-topic` takes any topic at publish. Must FAIL **(d)**. Following the undeclared topic is still refused, by `canRead` (`not_readable`), which (d) also flags since it isn't `no_topic`.
- `GOAL_CONTROL=fresh-chain` lands a published event's delivery one hop on but in the owner run's chain or a new one. Must FAIL **(g)**: the fan-out's branches each start a budget. The ring still stops at hop 6 (its hop alone bounds a ring), so (e) stays green.
- `GOAL_CONTROL=main-seam` is today's `main` for the seam: no service route, so a publish starts the routing entry as its sender in a child session and nothing fires its owner runs. Must FAIL **(a)**; (e) and (g) fail or read 0 with it, since nothing is delivered at all. Today's `main` itself has none of the API this run imports (`internalServiceFlow`), so it stops before grading.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-11 | 888824d1 | n/a | FAIL (expected) | `GOAL_CONTROL=owner-run-hop`: (e) 0 refusals, 60 passes, 60 deliveries all at hop 1 (the cap, 30 per routine); (g) 91 places in 91 chains, CAN'T TELL on g · passes refused. |
| 2026-11-11 | 888824d1 | n/a | FAIL (expected) | `GOAL_CONTROL=free-topic`: (d) only: `deploy.finshed` published; its follow refused `not_readable`, not `no_topic`. |
| 2026-11-11 | 888824d1 | n/a | FAIL (expected) | `GOAL_CONTROL=fresh-chain`: (g) only: 91 places in 91 chains, 91 publishes. |
| 2026-11-11 | 888824d1 | n/a | FAIL (expected) | `GOAL_CONTROL=main-seam`: (a) r-failed 0 of 2, r-report 0 of 1; (e) 0 deliveries; CAN'T TELL on e, f · message rows, g. |
| 2026-11-11 | 888824d1 | n/a | FAIL (expected) | Ad-hoc mutation, `self` answers nothing: (b) the publisher heard 3 of its own; (a) the same rows; (e), (g) moved too, since the publishing session, woken by itself, carried that chain into its later publishes. |
| 2026-11-11 | 888824d1 | n/a | FAIL (expected) | Ad-hoc mutation, no own-user filter on the seam's route: (c) the teammate heard 3; (a) the same rows. Nothing else. |
| 2026-11-11 | 888824d1 | n/a | FAIL (expected) | Ad-hoc mutation, the publish answers `{ published, to }`: (f) only. |
| 2026-11-11 | 888824d1 | n/a | PASS | 4 publishes heard as the oracle says by 5 routines; publisher, teammate and other org 0; undeclared topic refused at publish and follow; ring stopped at hop 6 after 5 passes; fan-out paid 6 places in 1 chain, 7 passes refused; 0 model calls. |
