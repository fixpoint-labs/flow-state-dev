# POC · the teammates host, with workforce as a kit and with a better install API

Retained design evidence for [FIX-2622](../../SPEC.md), not production code. Throwaway.

**Question.** Of the wiring in `labs/teammates/host.mts`, what does installing workforce as a
kit remove that a better workforce install API cannot? The epic's
[O1](../../../../epics/FIX-2618/DECISIONS.md#o1) (kits, yes) was decided with that question open.

**Run** (from the repository root, after `pnpm install`; about six minutes):

```bash
bash specs/issues/FIX-2622/poc/kit-or-api/run.sh
FIX2622_SKIP_CONTRACT=1 bash specs/issues/FIX-2622/poc/kit-or-api/run.sh   # without the contract column, about two
FIX2622_STEPS="1" bash specs/issues/FIX-2622/poc/kit-or-api/run.sh         # the attribution table alone, a second
```

## The hosts

| Folder | What it is | Added to a package |
|---|---|---|
| (today) | `labs/teammates/host.mts` at `f60ca70a7`, unchanged | — |
| [`b0-main-api/`](b0-main-api/host.mts) | **The control nobody asked for.** Today's host on today's API, used as it allows: the agent flow handed over as a `workerFlow(...)` builder, which `createWorkerInstallation` already builds on itself, and every cast `tsc` doesn't need dropped | nothing |
| [`a-kit/`](a-kit/host.mts) | **Variant A.** Workforce installed as a kit: [`define-kit.ts`](a-kit/poc-kit/define-kit.ts) is a rough `defineKit` and `createFlowState({ kits })` (slots that merge or refuse, `requires` order, an owned directory opened with `openRoot`, flows merged by id); [`workforce-kit.ts`](a-kit/poc-kit/workforce-kit.ts) is workforce as one: its `workforce/` directory, read at install by its own reader, and a `workerFlows` slot | 146 code lines (kit 111, workforce kit 35) |
| [`b-api/`](b-api/host.mts) | **Variant B.** No kit. [`install-workforce.ts`](b-api/poc-api/install-workforce.ts) is one call workforce would add: read the tree and refuse its problems, build the installation on the worker flows given, hire, and hand back the flows by id | 34 code lines |

Both variants keep every flow, the coder routing and the two read-only flows exactly as today.
Each touches only the lines its change removes; casts outside them are left for B0 to account
for. A and B take the same options and were built to the same bar; their hosts differ only at
the install site (`diff a-kit/host.mts b-api/host.mts` is 50 lines, all of it there).

## What it checks

1. **Attribution** ([`attribute.mjs`](attribute.mjs)). Each of today's wiring lines and casts is
   a row, keyed by anchors in today's host. Every anchor must match today's host as often as the
   row says, and today's host read as a variant must come out "neither" on every row (the
   control), or the script fails. A row B0 also removes is credited to neither change.
2. **Host parity** ([`parity.test.ts`](parity.test.ts)), on every host in process with the model
   scripted and every coding run on harness-manager's scripted harness: `GET /api/flows` lists
   exactly today's ids (`agent`, `harness-readiness`, `lab-context`, `teammates-coder`,
   `workforce-roster`), and one action per flow shows it is wired: `read` on the two read-only
   flows, a hire and a roster read that lists it, one scripted Lead turn on the agent copy, and a
   task Lead files that reaches the coding run's review on the coder copy.
3. **The control that must fail**: variant A with `lab-context` removed
   ([`control-no-lab-context.patch`](control-no-lab-context.patch)). Its red output is
   [`control-red.txt`](control-red.txt).
4. **The lab's own checks, per variant**, each copied over `labs/teammates/host.mts`: the
   lab's typecheck, the four host tests (`checks`, `drain-budget`, `run-timeout`,
   `working-folder`) and the contract test's real-adapter column.
5. **Cost** ([`cost.test.ts`](cost.test.ts)): opening each host until its first
   `GET /api/flows` answers, in rotated order, as paired differences against today's host
   in the same round, with today's host again under another name as an A/A control.

## Result, 2026-11-10 (`main` at `f60ca70a7`)

**Every check passes on every host, and every control fails as it must.** Parity: all four
hosts serve today's five ids and pass each action. Control: the host without `lab-context` fails,
naming the missing id ([`control-red.txt`](control-red.txt)). Lab checks: typecheck, the four
host tests and the contract test's real column pass for B0, A and B (43 of 43 each).
Attribution: today's host reads "neither" on all 16 rows.

**The verdict: the "A only" row is empty. B removes everything the kit removes.**

| Today's wiring | Lines | Casts | B0 | A | B | Credit |
|---|---|---|---|---|---|---|
| `TEAMMATES_TREE` and its comment | 2 | 0 | kept | **gone** | **gone** | both |
| `readDeclaredRoster` import | 1 | 0 | kept | **gone** | **gone** | both |
| `readDeclaredRoster(...)` call | 1 | 0 | kept | **gone** | **gone** | both |
| the problem check (`if`, `throw`, `}`) | 3 | 0 | kept | **gone** | **gone** | both |
| `createWorkerInstallation` and `hireWorkforce` imports | 2 | 0 | kept | **gone** | **gone** | both |
| the hand-spread flows map (`[...copies, ...]`) | 1 | 0 | kept | **gone** | **gone** | both |
| `let flows = {}`, `flows = {`, `};` (the callback) | 3 | 0 | **gone** | **gone** | **gone** | neither change: removable on main |
| `workerFlows: () => flows as never` (the callback) | 1 | 1 | **gone** | **gone** | **gone** | neither change: removable on main |
| `hireWorkforce(installation) as Array<{ id: string }>` | 1 | 1 | **gone** | **gone** | **gone** | neither change: removable on main |
| `createFlowState({ ... } as never)` | 0 | 1 | **gone** | kept | kept | neither change: removable on main |
| three harness blocks, `as never) as unknown as HarnessBlock`, and the type import | 1 | 9 | **gone** | kept | kept | neither change: removable on main |
| readiness flow: `as never`, `as never`, `as { id }` | 0 | 3 | **gone** | kept | kept | neither change: removable on main |
| lab-context flow: `as never`, `as never`, `as { id }` | 0 | 3 | **gone** | kept | kept | neither change: removable on main |
| the `harness-readiness` flow | 4 | 0 | kept | kept | kept | neither (views, FIX-2623) |
| the `lab-context` flow | 20 | 0 | kept | kept | kept | neither (views, FIX-2623) |
| lab-context's delegates, read off the workers | 6 | 1 | kept | kept | kept | neither (views, FIX-2623) |

| Credit | Rows | Lines | Casts |
|---|---|---|---|
| both A and B | 6 | 10 | 0 |
| A only | 0 | 0 | 0 |
| B only | 0 | 0 | 0 |
| neither change: removable on main today (B0) | 7 | 6 | 18 |
| neither: views (FIX-2623) | 3 | 30 | 1 |

| Host | Lines | Code lines | `as never` | All casts | diff vs today | Added to a package (code lines) | Under ER-1's 300 |
|---|---|---|---|---|---|---|---|
| today | 426 | 269 | 9 | 20 | — | — | no |
| B0 · today's API | 428 | 271 | 0 | 2 | −44 +46 | 0 | no |
| A · workforce kit | 419 | 264 | 8 | 18 | −50 +43 | 146 (kit 111, workforce kit 35) | no |
| B · better install API | 418 | 263 | 8 | 18 | −56 +48 | 34 | no |

**Cost of opening a host** (20 rounds, rotated, paired medians against today's host):

| | Readiness checks stubbed | Real readiness checks |
|---|---|---|
| today again (A/A control) | −3.4 ms | **−31.6 ms** |
| B0 | −1.9 ms | −13.2 ms |
| A · kit | +19.6 ms (18/20 slower) | +58.2 ms |
| B · install API | +21.2 ms (19/20 slower) | +16.9 ms |
| A − B | **+1.6 ms** (13/20) | +33.1 ms |

The run with real readiness checks is not a measurement: its A/A control is off by 32 ms, because
each host starts three readiness checks in the background, which spawn processes. With them
stubbed, the A/A control sits within 4 ms, and A costs the same as B within noise. Both open about
20 ms slower than today's host, and B0 doesn't. What A and B share and B0 lacks is reading the
tree later, after the host has started its folder check. That cause is not confirmed, and it bears
on neither variant over the other.

## What it showed

1. **The kit removes nothing a better install API doesn't.** The two variants' hosts differ
   only at the install site, and are within one line of each other in length (419 and 418). Each removes the same 10 lines: the tree read and its
   refusal, the two install imports, and the hand-spread map. A puts 146 lines in packages for
   it; B puts 34.
2. **The pain the epic names is mostly not workforce's API at all.** Eight of the nine
   `as never` casts are dead on `main`: `tsc` passes the lab without them, and B0 drops them.
   The ninth, and the circular `workerFlows: () => flows` callback, go away with
   `workerFlow(...)`, which workforce already exports and the lab's own coder flow already uses.
   That is [D1](../../DECISIONS.md#d1)'s mind-changer, more strongly than it was written: the
   callback and the casts trace to no signature at all.
3. **No host reaches ER-1's 300-line bar.** The install was never the bulk. What remains is the
   three harness factories, the two read-only flows (30 lines, views' to remove), the lab's
   option parsing and the agent flow's configuration.
4. **What a user would configure** (for FIX-2626's scaffold): the agent flow's entry (memory,
   history summary, tool catalog, `uses`, `maxSteps`, shown settings) and the coder flow's
   (harnesses, default harness, workspace, checks, run budget). The roster flow, the
   readiness flow and the kit's plumbing are not configured. `lab-context` is the lab's own.
5. **What this POC does not test.** O1 rests on the client half: a kit's client removing the
   adapters at the root. Only the install half is in this host, and it shows nothing a kit does
   that an install API can't. A second kit is not tested either: slot refusal across kits,
   `requires` order and kit-to-kit contributions have one consumer here, so they are untested.
   The dependent-kit folder question never came up.

The verdict goes to the owner as a reason to reopen O1. It does not decide it.
