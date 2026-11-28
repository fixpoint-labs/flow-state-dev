# sessions-reach › name a session

**Issue:** FIX-2942 (epic FIX-2941). Its spec's goal: `specs/issues/FIX-2942/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** Within one owner, a block reads and writes another session's resources by naming the session (`ctx.resources.at({ session }).notes`), and a session outside that owner is answered as missing, the way the HTTP routes answer it. The session written hears each write once, and a burst of writes starts one turn there. A turn a webhook delivery fired reaches no session but its own.

**Input:** `fixtures/default.json`: the org, another org, the person, another person, and another tenant. Held-out: `GOAL_FIXTURE=alternate.json` (other names throughout) must give the same verdict. The flows are fixed by the row: `alpha` and `beta` both declare the same `notes` collection and an `inbox` collection whose `wakeEntry` is `inboxChanged`; `vault` declares them too, behind a resolver of its own.

**Signal:** each failure is tagged `<row>:<assertion>`. A refusal is graded as the bytes the block got back for an id nobody holds.

- **same-owner** `read`, `list`, `write`: a block in alice's `alpha` session reads, lists and writes her `beta` session's notes, and that session's own run reads the write as its data. `one-notice-per-write`: the `beta` session's topic hears one resource notice for the write; the caller's hears none. `one-turn-per-burst`: twenty writes into the `beta` session's inbox in one run start exactly one turn of its `inboxChanged` entry, which reads all twenty rows; no turn runs anywhere else.
- **refusal** `other-user`, `other-org`, `other-tenant`, `no-org`, `own-resolver`, `machine`: bob's session, alice's session in another org, a session stored under the same key for another tenant, a session with no org, alice's `vault` session (its resolver did not produce the run's principal), and any session from a machine's run each answer read, list and write exactly as an id nobody holds; none of them holds a refused write afterwards.
- **webhook** `the-owner-run-is-refused`: an owner run a webhook delivery fired (an internal dispatch carrying the delivery's origin, as a service delivery's owner runs do) is refused on read, list and write of the `beta` session, and nothing lands. `names-the-rule`: every refusal, an unknown id's included, is the same bytes, and none names the session. `own-session`: the same run lists its own session's notes.

**Anti-game:** every answer is what the probe block got back from `ctx.resources.at`, serialised as it saw it, never the admission function's return. What the named session heard is read off the host's change bus and from the turns its entry actually ran under the host's own sweeper. Sessions are born from runs at the host's door (its resolver reads two headers, `vault`'s its own); only the two cases no door can make (another tenant's record at the caller's key, a record with no org) are planted as a store holds them.

**Not here:** the principal's mechanisms (own-resolver admit, absent `resolvedBy`, a schedule naming a person, sticky kind, backfill, pre-org retry) and their eight controls are graded at the admission function in `goals/sessions-reach/one-principal/`, which this reach goes through. `acrossSessions()` and a board's settle on its claimed task's session belong to the board's own reach; neither goes through `ctx.resources.at`, so the fence here never sees them.

**Model:** n/a

**Run:** `pnpm tsx goals/sessions-reach/name-a-session/run.mts`

**Controls:** `GOAL_CONTROL=<name>` on the same command. Each is a scratch patch to the engine's modules, applied as the process loads them (`goals/lib/module-patch.mts`); the run prints the patch and fails if it never reached the code.

- `owner-user-only` (the owner comparison checks the user only) must FAIL **`refusal:other-org`**. The other-tenant case stays refused: the admission's own tenant check stops it before the comparison.
- `turn-per-write` (the wake store keeps each write's wake apart instead of coalescing) must FAIL **`same-owner:one-turn-per-burst`**.
- `webhook-source-only` (the fence reads the `webhook` source only, not the origin a delivery's owner runs carry) must FAIL **`webhook:the-owner-run-is-refused`**. It also fails `webhook:names-the-rule`: the reads it lets through are not the refusal. Known co-failure.

The engine's vitest suite proves the reach with plain positive and refusal cases (`packages/engine/test/context/named-session-reach.test.ts`); this goal is where each rule is seen to fail under its control.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-27 | fix/FIX-2942-reach on 4dfb534, uncommitted | n/a | PASS | all three rows; B heard 1 notice, A none; 20 writes started 1 turn reading 20 rows; 5 refusal cases and a machine's run matched the unknown id on 3 verbs; the delivery's run refused alike |
| 2026-11-27 | same | n/a | PASS · `alternate.json` | same verdict with `initech`/`umbrella`, `dana`/`erin`, `t-south` |
| 2026-11-27 | same | n/a | FAIL (expected) · each control | `owner-user-only`: `refusal:other-org` (read, list and write reached it, and the write landed). `turn-per-write`: `same-owner:one-turn-per-burst` (20 writes started 3, then 4 turns: writes in one millisecond still fold). `webhook-source-only`: `webhook:the-owner-run-is-refused` (read, list and write of b answered), with `webhook:names-the-rule` |
| 2026-11-27 | fix/FIX-2942-reach on 57dc19d, uncommitted (owe before write) | n/a | PASS · both fixtures | all three rows; 20 writes started 1 turn reading 20 rows within the row's window. The wake is now owed before each write, fenced by the request's lease, so that turn holds the wake to the lease and one more, empty turn runs there (60s by default), past this row's window |
| 2026-11-27 | same | n/a | FAIL (expected) · each control | `owner-user-only`: `refusal:other-org`. `turn-per-write`: `same-owner:one-turn-per-burst` (4 turns). `webhook-source-only`: `webhook:the-owner-run-is-refused`, with `webhook:names-the-rule` |
| 2026-11-27 | fix/FIX-2942-reach on 4f4774d, uncommitted (wakes keyed per resolver) | n/a | PASS · both fixtures | all three rows; the burst is one resolver's, so 20 writes still start 1 turn reading 20 rows. `turn-per-write` now patches the key's `base` line, the only change to the row |
| 2026-11-27 | same | n/a | FAIL (expected) · each control | `owner-user-only`: `refusal:other-org`. `turn-per-write`: `same-owner:one-turn-per-burst` (4 turns). `webhook-source-only`: `webhook:the-owner-run-is-refused`, with `webhook:names-the-rule` |
| 2026-11-27 | fix/FIX-2942-reach-followup on 9231732, uncommitted | n/a | FAIL (expected) · `webhook-source-only` | the named-copy code moved to `context/named-session-copy.ts`, so the control stopped as "control patch target not found" (exit 4). Repointed to that module; fails `webhook:the-owner-run-is-refused`, with `webhook:names-the-rule` |
| 2026-11-28 | fix/FIX-2942-session-resources-wording on 926cbe0, uncommitted | n/a | PASS, and FAIL (expected) · `webhook-source-only` | the module is renamed `context/named-session-resources.ts` and the control repointed to it; the run passes, and the control fails `webhook:the-owner-run-is-refused`, with `webhook:names-the-rule` |
