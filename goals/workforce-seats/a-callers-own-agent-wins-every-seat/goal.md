# A caller's own `agent` wins every seat

A team that does not want our stock worker hands the installation their own flow under `agent`, and
theirs runs every worker on the roster — including the records that never mention a flow at all.
Rewritten for FIX-1788: workers are data on one registered copy of their flow.

## The contract

Three worker records, one installation, the app's own `agent` among its worker flows:

(a) One call to `hireWorkforce` registers **one** copy of `agent`, at its kind, and none at any
worker's id.

(b) **Every** worker runs on it, as itself. Each one's session is created naming it through the
real HTTP route, and runs to completion there. A block nested inside the action loads the turn's
worker through the installation and records its own record's body as `instructions` and its
`desk`, a setting only the caller's flow declares. Two records leave `flow:` out entirely and one
writes `flow: agent`; both shapes must land on the caller's flow.

**Control:** `GOAL_CONTROL=builtin-agent` hands the installation no flow of its own, so `agent` is
the built-in. Must FAIL: the built-in declares no `desk`, so every worker is refused before anything
registers, each named.

## Why it is shaped this way

Counting copies is the trap: one copy comes back whichever flow it is. So the check reads each
worker's identity through what its own turn loaded instead.

No model runs. What is graded is which flow answered and which settings reached it, so the workers
run on handlers.

**Model:** n/a — handlers only. The property under test is which flow answered and which settings reached it, not model output.

**Run:** `pnpm tsx goals/workforce-seats/a-callers-own-agent-wins-every-seat/run.mts`

## Runs

| Date | Branch | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-08 | `865abc573` + FIX-1788 P4 | n/a | PASS | One `agent` copy, the caller's, for three workers (1 naming the flow, 2 naming none); each ran through the real HTTP route in a session naming it, and its own body and `desk` reached the nested block. |
| 2026-10-08 | `865abc573` + FIX-1788 P4, `GOAL_CONTROL=builtin-agent` | n/a | FAIL (expected) | `hireWorkforce: 3 standard worker problem(s); nothing was registered`, each worker named for `"desk" is not a declared setting`. |
| 2026-09-13 | fix/fix-1363 | n/a | PASS | All three seats resolved to the caller's flow (1 naming the kind, 2 naming none), registered, and one ran end to end with its own body arriving as `instructions`. The control run minted three seats and was refused at registration. |
| 2026-09-13 | fix/fix-1363 (control: built-in merged *over* the caller's kinds) | n/a | FAIL (expected) | With the precedence inverted, all three records hired into the built-in and were refused at the mint — `Flow "agent" instance "engineering.lead" has an invalid config bag: "desk" is not a declared setting`. Pins that the check is sensitive to the merge order, which is the one line acceptance criterion 4 rests on. |
