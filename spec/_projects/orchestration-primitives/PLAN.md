# Orchestration Primitives — the arc

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Live status is [Spec](SPEC.md) → *the epics*; this page is the order and what each hands the next.

![The arc](figures/arc.svg)

Each lane is an epic, its bar running from filed to wrapped; a green bar is done, a blue one is in
flight, a grey outline was canceled, a lane with no bar is filed but not started, and the red line
is today.

## The order, and what each hands the next

| Epic | Consumes | Releases |
|---|---|---|
| Plan/Task series | — | The Task row, TaskCollection, the task board; patterns as board configurations |
| FIX-930 · delegation | The board | A roster, a default worker, context supply; skills that delegate through the board |
| FIX-939 · durable jobs | The board, the roster | Detached tasks under a lease; the claim ticket |
| FIX-980 · honest substrate | The claim ticket | Versioned task writes; park and unpark; settles a caller can trust |
| FIX-1320 · flow instances | — | A global address for each flow instance |
| FIX-1312 · dispatch protocol | An address | `dispatcher()` with reply-to-sender, as transport for flow code |
| FIX-1870 · dispatchTask, canceled Oct 21 | The honest board, reply-to-sender | `dispatchTask`; coordinator posts as task rows, with `handOff` and the delivery ledger gone. Superseded by FIX-2056 before it wrapped |
| FIX-2056 · one task primitive | The honest board, reply-to-sender, FIX-1047's claim in task tools, FIX-1870's D2, the coordination model ([#3534](https://github.com/fixpoint-labs/flow-state-dev/pull/3534)) | One task with plan and delegation boards; one completion rule at the claim gate; five task tools, `createTask` and `getTask({ id, wait })` replacing `dispatchTask`; posts as routed tasks; every ending to its filer once |
| FIX-2058 · one Inbox | FIX-2056's claim gate and steer, durable execution by default (FIX-2063) | One Inbox item per stop for a person; the answer by steer; `answerTask` and the parks retired ([*decided once*](DECISIONS.md)) |
| FIX-2070 · messages | FIX-2056's task and its sessions | Send and call, delivery and budget; `receive` in place of today's message entry |
| FIX-2092 · phased workflows | FIX-2056's delegation board and `onTaskSettled`, FIX-2058's holds for an approval between phases | Phases as a view over task rows; a template that files a phased task graph. A design to prove by POC before its spec |
| FIX-2071 · coordination renames | FIX-2058, FIX-2070's builds | One term per thing, *hold* and `updateTask`'s `question` field included; FIX-2056's read for retired rows removed no earlier than here |

FIX-2071 built once FIX-2070's builds had landed and wrapped Oct 30, ahead of FIX-2070's closure
(FIX-2242).

FIX-2056's wrap recommended fixing FIX-2182 (a dispatcher's `wait` restates the board's `mode`)
and FIX-2183 ("hold" names four things) before FIX-2058 built on them. Neither was done, and
FIX-2058 shipped without them; both are still Backlog, and FIX-2058's wrap analysis lists FIX-2183
as still open.

## What FIX-2056 left open

The closure, FIX-2087, passed on `main` at round 5
([#3847](https://github.com/fixpoint-labs/flow-state-dev/pull/3847)); the last fix was FIX-2181
([#3856](https://github.com/fixpoint-labs/flow-state-dev/pull/3856), 6ed70211). Wrap verdict:
right approach, with changes.

| Carried forward | What it is |
|---|---|
| FIX-2101 cause 2 | A hand-off killed mid-call; waits on a product decision |
| FIX-2125 | Stores flush queued writes on close |
| FIX-2169 | Seconds-scale crash recovery by an owner-liveness lease ([*decided once*](DECISIONS.md)) |
| FIX-2182, FIX-2183, FIX-2184 | The wrap analysis's three: `wait` restates `mode`, "hold" overloaded, no event-order check on "each ending once" |
| FIX-2178, FIX-2179, FIX-2180 | Folds: upgrade calls, "is a request running", the schedule check |
| FIX-2186–2188, FIX-2190–2193 | Debt filed at wrap |

Lessons are draft [#3849](https://github.com/fixpoint-labs/flow-state-dev/pull/3849) and the docs
polish draft [#3848](https://github.com/fixpoint-labs/flow-state-dev/pull/3848).

## What FIX-2058 left open

The closure, FIX-2134, passed on `main` at 83c444b on its third run
([#3951](https://github.com/fixpoint-labs/flow-state-dev/pull/3951), merged Oct 27): six kinds of
stop, each one Inbox item answered once, with a real model and a real Claude Code session. Its five
findings (FIX-2219, FIX-2220, FIX-2221, FIX-2222, FIX-2224) are Done. Wrap verdict: right approach.

| Carried forward | What it is |
|---|---|
| FIX-2230 | A raw `ctx.suspend({ reason: "human_*" })` is a second route to a person's stop that skips the deadline and the cancel |
| FIX-2228 | A judge's unsure `not-done` or `ask` completes the task |
| FIX-2225, FIX-2226 | Model-free goals and controls are not in CI; no shared verdict reader for closures |
| FIX-2216 | Shift Manager shows a task waiting on a person under RUNNING |
| FIX-2169, FIX-2165 | With no default deadline, crash recovery and liveness are the bound on a forgotten stop |
| FIX-2227, FIX-2229, FIX-2231 | Doc drift and superseded Human-in-the-Loop backlog |

FIX-2215, a review's *request changes* carrying the reviewer's words, went to Workforce: Shift
Manager. Lessons are [#3953](https://github.com/fixpoint-labs/flow-state-dev/pull/3953) and the
docs polish [#3954](https://github.com/fixpoint-labs/flow-state-dev/pull/3954).

## What FIX-2071 left open

The closure, FIX-2249, merged Oct 30
([#4244](https://github.com/fixpoint-labs/flow-state-dev/pull/4244)). Lessons are draft
[#4245](https://github.com/fixpoint-labs/flow-state-dev/pull/4245): two owner asks (give the
second-look review its own identity; one BP-030 sentence) and fold candidates F1–F7 to file.

## Milestones

The Linear project keeps three milestones; v3 (True Plan Mode shipped) and v5 (docs and pattern
catalog shipped) were deleted on Oct 12 when their issues moved out.

| Milestone | What it marks | Where it stands |
|---|---|---|
| v1 · Primitive shipped | Task, TaskCollection, the board | Reached with the Plan/Task series, May 1 |
| v2 · Existing patterns migrated | Board-based patterns reshaped onto the primitive (FIX-447, FIX-448) | Reached with the Plan/Task series, May 1. Patterns off the board are outside it |
| v4 · Skills declare patterns | Skills naming a pattern in `SKILL.md` frontmatter (FIX-450) | Shipped May 20, then reversed by FIX-918 in July ([PD-2](DECISIONS.md)). The milestone's name and description still describe the reversed design |

FIX-2056's closure ran the coordinator and hand-off goals on one `main` commit and passed on
Oct 24; FIX-2058's closure walked every stop for a person and passed on Oct 27. The project's
next regression gate is FIX-2070's closure.

## Deliberately not next

- **True Plan Mode (FIX-312, FIX-449)** moved to Human-in-the-Loop, and **the architecture page
  and pattern catalog (FIX-451)** to Multi-Agent Patterns, and their milestones (v3, v5) were
  deleted ([Decisions](DECISIONS.md) → *decided once*). Neither is this project's to finish.
- **Patterns that run off the task board**, today `roundRobin` and `debate`. They are outside the
  outcome; FIX-922 decides whether they stay patterns ([Decisions](DECISIONS.md) → *decided once*).
- **A "question" task class shown differently in the UI, and a model-facing tool for tells.**
  The first is deferred until something needs it; the second is not added ([PD-3](DECISIONS.md)).
- **Waiting on several tasks at once, and a row-less question tool for workers.** FIX-1870 ruled
  both out and FIX-2056's five task tools add neither; neither has an epic.
- **Spend caps on delegated work (FIX-933).** Filed under FIX-930, never started.
- **Anything after the renames.** FIX-2071 wrapped Oct 30 and no epic is filed after it. The
  project's remaining life is FIX-2070's closure and FIX-2092.
