# sessions-reach › it one principal

**Issue:** FIX-2942 (epic FIX-2941). Its spec's goal: `specs/issues/FIX-2942/SPEC.md` → "The goal, and how we'll know it's met", the principal's rows.

**Outcome:** A run carries one principal, set at the door and carried unchanged, and a named reach admits exactly what that principal may reach. A run whose principal a flow's own resolver produced reaches that flow's other sessions; one no resolver of the target's produced reads it as missing. A schedule naming a person reaches that person's sessions; one running as the gateway is a machine and reaches nothing. A machine's session stays a machine's through any later write. A session from before kinds reads as the request that created it, and as a machine's when nothing proves who did. An owner retrying a request id from before organizations keeps it.

**Input:** `fixtures/default.json`: the organization, the person, another person, the person a schedule names, and the scheduler's gateway user. Held-out: `GOAL_FIXTURE=alternate.json` (other names throughout) must give the same verdict. The flows are fixed by the row: `notes` (host rule), `vault` and `vault-lax` (one resolver of their own, under two host settings), `polls` (four schedules: the fallback, the gateway named, the person named twice).

**Signal:** each failure is tagged `<row>:<assertion>`. A refusal is graded as the bytes the admission gives for an id nobody holds.

- **own-resolver** `admit`: a run born at `vault`'s door reaches `vault`'s other session.
- **absent** `no-principal-resolver`, `no-target-resolver`, `both-absent`, `other-settings`: a principal with no `resolvedBy`, a target whose resolver can't be named, both, and a principal from `vault-lax`'s door (same resolver, other settings) each read `vault`'s session as missing.
- **schedule** `person-reaches`: the named person's first schedule reaches the session of their second. `person-misses-own-resolver`: it reads the person's `vault` session as missing. `gateway-is-machine`: the fallback and the gateway-named schedule both run as machines, and neither reaches the other's session (each still holds its own).
- **sticky** `kept`: after a stale whole-record write carrying `person` onto the fallback schedule's session, the session reads `machine` and a later run in it, with no kind of its own, runs as a machine. `reaches-nothing`: that run reads the other schedule's session as missing.
- **backfill** `person-sources`: a session from before kinds whose birth request is `http`, one from before `source`, a dispatched child its parent is proven for, and a 31-hop chain each reach the target. `no-request`, `machine-sources` (scheduled, webhook, notification, a custom source), `recreated-parent`, `missing-parent`, `past-depth` (33 hops) each read it as missing.
- **pre-org** `owner-reuses`: the owner retrying a request id whose record predates orgs is given the same id, and the claim keeps it. `other-refused`: another person is given another id, and their claim is refused.

**Anti-game:** every reach is graded on what the one admission function a block's named reach goes through (`admitNamedSession`) answers for a real target, never on `principalOwns`, `resolvedByMatches` or a session's recorded kind alone. Refusals are compared with the unknown id's answer byte for byte. Principals are the ones a real door set, read back from the request record the run wrote: an HTTP-door dispatch, the scheduled route behind its bearer secret, a run with no kind of its own. Records from before a field are planted as a store held them, with their birth request written just before the session and last written after it, as a real action writes it, and a later internal turn moments after the birth.

**Model:** n/a

**Run:** `pnpm tsx goals/sessions-reach/one-principal/run.mts`

**Controls:** `GOAL_CONTROL=<name>` on the same command. Each is a scratch patch to the engine's modules, applied as the process loads them (`goals/lib/module-patch.mts`); the run prints the patch and fails if it never reached the code.

- `own-resolver-closed` (every own-resolver target refused) must FAIL **`own-resolver:admit`**.
- `resolved-by-loose` (absent `resolvedBy` on both sides compares equal) must FAIL **`absent:both-absent`**.
- `schedule-as-machine` (every scheduled fire is a machine) must FAIL **`schedule:person-reaches`**.
- `schedule-person-unscoped` (a principal no resolver produced matches own-resolver targets) must FAIL **`schedule:person-misses-own-resolver`**. It also fails `absent:no-principal-resolver` and `absent:both-absent`: the same rule, seen from a door principal stripped of its resolver. Known co-failure, not a leak.
- `kind-not-sticky` (the session store writes whatever kind a write carries) must FAIL **`sticky:kept`**.
- `backfill-as-person` (a session with no readable birth request reads as a person's) must FAIL **`backfill:no-request`**.
- `parent-by-bare-id` (a child inherits from whatever record holds its parent's id) must FAIL **`backfill:recreated-parent`**.
- `claim-exact-raw` (the request-id claim compares a pre-org record as stored) must FAIL **`pre-org:owner-reuses`**.

The engine's vitest suite proves each mechanism with plain positive and refusal cases (`packages/engine/test/context/principal-mechanisms.test.ts`, `session-kind.test.ts`); this goal is where each is seen to fail under its control.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-27 | fix/FIX-2942-admission on d736e17, uncommitted | n/a | PASS | all six rows; 3 person sessions reached the target, 9 unproven ones read as missing |
| 2026-11-27 | same | n/a | PASS · `alternate.json` | same verdict with `globex`, `dana`/`erin`, `u_frank`, `nightly-runner` |
| 2026-11-27 | same | n/a | FAIL (expected) · each control | `own-resolver-closed`: `own-resolver:admit` (v2 read as null). `resolved-by-loose`: `absent:both-absent`. `schedule-as-machine`: `schedule:person-reaches`. `schedule-person-unscoped`: `schedule:person-misses-own-resolver`, with `absent:no-principal-resolver` and `absent:both-absent`. `kind-not-sticky`: `sticky:kept` (reads "person"). `backfill-as-person`: `backfill:no-request`. `parent-by-bare-id`: `backfill:recreated-parent`. `claim-exact-raw`: `pre-org:owner-reuses` (given a derived id; the claim refused) |
| 2026-11-27 | fix/FIX-2942-admission on 0807493, uncommitted | n/a | PASS | all six rows; each of the eight controls fails its named row (birth window from the host grace; ambiguous births read as a machine's) |
| 2026-11-27 | fix/FIX-2942-parentless-birth on eafc495, uncommitted | n/a | PASS · default and `alternate.json` | all six rows, with the later internal turn back at +5 ms; each of the eight controls fails its named row (a request last written before the birth is not a possible birth; a live one at or before it outranks later turns). Before the session-kind change the same fixture FAILS `backfill:person-sources` (`l-http`, `l-child`) |
| 2026-11-27 | fix/FIX-2942-reach-followup on cf0241b, uncommitted | n/a | FAIL (expected) · `kind-not-sticky` | the control drifted after #5805: the write-once rule became `withWriteOnceSessionFields`, so its old target was gone and the control crashed on the patch rather than failing its row. Repointed to skip the restore for `principalKind` only; fails `sticky:kept` (reads "person") |
