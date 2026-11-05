# FIX-2460 · Testing package: support suspensions and durability, and split benchmark and bundle tooling into subpaths

**Spec** · [Decisions](DECISIONS.md)

## Seven people, before and after

| Someone who… | Today | After |
|---|---|---|
| **unit-tests a step that waits for a person** | `testFlow` returns `failed`: *"stopping for a person needs durable execution"*. Nothing in the package can park the stop | The run comes back `suspended` with the stop on it. `run.answer({ action: "approve" })` returns the run that followed, with its status, output and items |
| **answers it wrong in a test** (an action the stop doesn't allow, a second answer, data that fails the schema) | n/a | Gets the same refusal a screen gets, thrown with the route's message |
| **has a generator after the approval** | n/a | The rest of the run uses the test's mocks. An unmocked generator follows the test's unmocked policy |
| **tests their own `ctx.suspend`** | Fails the same way | `run.resume(...)` continues it, through the route the client's `resume` uses |
| **autocompletes `@flow-state-dev/testing`** | 90 names: test helpers beside a benchmark suite (21 names), two import-graph scanners and a package marker. Six of the benchmark types are on core's root too | The helpers for testing an app and evals. Benchmarking is at `testing/benchmark`; the scanners are off the published surface |
| **writes a benchmark or runs `fsdev benchmark`** | Imports from the roots of testing, patterns and core | Imports from `testing/benchmark` and `patterns/benchmark`. The run is the same |
| **tests a sequencer or a router** | Picks between `testBlock`, `testSequencer` and `testRouter` | `testBlock`. Its result carries the steps and side chains for a sequencer and the chosen route for a router |

Durable-by-default and `ctx.suspendForUser` shipped in the same window, and the testing package
can't exercise either. The first row is the epic's
[fourth team](../../epics/FIX-2447/SPEC.md#five-teams-before-and-after).

## The goal, and how we'll know it's met

**An adopter tests a step that waits for a person with the published testing package alone:
runs it, sees it stop, answers it as a screen would, and sees what happened next. The package
root offers only what testing an app needs.**

| Is it the right goal? | |
|---|---|
| **The real need** | *"An adopter cannot unit-test a `ctx.suspendForUser` approval step, even though durable-by-default and suspendForUser shipped this window"* (the issue), and the epic's *Surface* row for every published root |
| **Smaller, and rejected** | "`testFlow` accepts a durability provider" (the issue's *runtimeConfig passthrough*). Leaves the answer to the adopter, who would wire a router, a registry and a provider by hand: the 40 lines our own engine test needs. `testFlow` builds that config itself instead; no general passthrough is added |
| **Bigger, and not this issue's** | A test helper that spawns or messages other sessions (FIX-1293). The Inbox's answer path for a task-board run, which FIX-2450 owns |
| **Not done if** | The answer or `resume` reaches the run by some route other than the engine's answer or resume route · a generator after the answer reaches a real model · the README example passes only in the workspace, not from the installed tarball · a benchmark, scanner or folded-helper name is still on the testing, core or patterns root, outside Q1's alias window · the benchmark names were deleted rather than moved, or `fsdev benchmark` stops running · a timer outlives `testFlow` and holds the test process open |

```mermaid
flowchart LR
  I["installed tarballs · empty project"] --> R["the README's approval-step test · verbatim"]
  R --> S["suspended · answer approve · answer again · reject path"]
  I --> E["root key census · testing, core, patterns · subpaths import"]
  S -->|"completed with output · second answer refused · mocks used after"| P["PASS"]
  E -->|"names off the roots and present on the subpaths"| P
  C["control · main at ebec5326 tarballs"] -.-> R
  C -.-> E
  S -.->|"under the control"| F["must FAIL"]
```

The check reads what an adopter's project sees after `npm install`. Under the control, the
README test fails at the first `expect` and the census finds `runBenchmark`.

| How we verify | |
|---|---|
| **Goal check** | A leg c assertion in `scripts/packed-install/run.mjs`, plus a root-key census under leg b. The closure manifest's *One path* and *Surface* rows hold their ids; this issue's PR flips them to `expect: pass` ([DECISIONS → Decided](DECISIONS.md#decided-not-asked)). Run by the implementer at completion; verdict in the implementation PR |
| **Signal** | The README test (the code block under its *Testing a step that waits for a person* heading) passes: `suspended`, then `completed` with the step's output; a `reject` reaches the block as a no; a generator after the answer returns its mock; a `ctx.suspend` resumed with `run.resume` completes. The process exits in under 10 s with no force-exit flag. Census: `Object.keys` of the testing, core and patterns roots holds none of the moved or folded names (the list is the census on `ebec5326`, written into the manifest), and `testing/benchmark` and `patterns/benchmark` import from the tarball and export every one of them |
| **Input** | The README's refund-approval example. A different stop kind (`input`, with a schema) must pass too |
| **Anti-game** | Assert on the installed tarball, never workspace `src`. Prove the route, not the message: the stop is first answered through the engine's own answer route on the same stores, as a screen would, and only then does `run.answer` have to refuse it. A helper that keeps its own record of answered stops, or validates with its own schema check, can't see that answer |
| **Control that must fail** | `run.mjs --control`: fails on *suspended* (today `failed`) and on the census (`runBenchmark` on the root, no `testing/benchmark`). In the implementation PR, a variant with `run.answer` swapped for a direct `continueRequest` must fail the refusal-after-screen-answer assertion |

## What changes

![Before and after for the testing package. Before: one root with test helpers, 21 benchmark names, two scanners and a marker, plus six benchmark types on core's root and eight on patterns' root; testFlow stops at failed. After: the testing root holds the test helpers and evals, testFlow parks, then answer or resume goes through the engine's routes in process; testing/benchmark and patterns/benchmark are public subpaths; the scanners sit behind a fence in a repo-only entry](figures/what-changes.svg)

Left is today, right is after. The top band is the run a test sees; the bottom band is where
each name lives, with the fence marking what adopters never see.

**An approval step, as a test writes it:**

```diff
  const run = await testFlow({ flow: refunds, action: "refund", input: { amount: 5 }, userId: "u1" });
- expect(run.status).toBe("failed"); // "stopping for a person needs durable execution"
+ expect(run.status).toBe("suspended");
+ expect(run.suspension).toMatchObject({ kind: "approval", prompt: "Refund 5?" });
+ const after = await run.answer({ action: "approve" });
+ expect(after.output).toEqual({ refunded: 5 });
```

```diff
- import { comparePatterns, defineBenchmark } from "@flow-state-dev/testing";
- import type { BenchmarkTask } from "@flow-state-dev/core";
- import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns";
+ import { comparePatterns, defineBenchmark, type BenchmarkTask } from "@flow-state-dev/testing/benchmark";
+ import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns/benchmark";
```

How a moved name reaches an adopter on 0.4.0 or testing 0.3.x is ER-3 / Q1's answer
([DECISIONS → Decided](DECISIONS.md#decided-not-asked)).

**Docs:** update the testing README (an approval-step example, `answer` and `resume`, the
`durable` option, the subpaths) and the patterns README's benchmark section; update
`testing/testing-flows` with a *Testing a step that waits for a person* section,
`testing/benchmarks`, `api/benchmarks` and the *choosing patterns with benchmarks* guide for
the new imports, `api/testing`, `testing/overview` and `testing/flow-integration-tests` for the
result's methods and the folded helpers, and one line in the human-in-the-loop guide pointing
to the test section. The repo's own teaching of the folded helpers moves with them (BP-034):
`AGENTS.md`, the `write-block-tests` and `tdd` skills, `development-setup.md`. Add the testing row to the *what each package root is for* page FIX-2448
publishes. No new page.

## How an answer reaches the run

```mermaid
flowchart LR
  T["testFlow"] -->|"durable · in-memory stores"| A["runAction"]
  A -->|"suspendForUser"| K["parked · checkpoint and stop stored"]
  T -->|"run.answer"| F["in-process fetch"]
  F --> R["the answer route · checks and lease"]
  R -->|"continueRequest · same runtime config"| A
  A --> O["the run that followed · status · output · items"]
```

The test enters the engine at the same door as a screen. Everything after the fetch is
engine code that ships today; the POC ran it ([Settled](DECISIONS.md#settled)).

## What stays as it is

- The engine. No new export, no route change: the answer and resume routes and their checks
  are used as they are.
- `testBlock` for every other block kind, `evalBlock` and `evalFlow`, the mocks,
  `createTestContext`, `./conformance`.
- `fsdev benchmark`'s behaviour and its scorecard. Only its imports move.
- What a test passes in `stores` to share state across runs.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| `suspension` · `suspendForUserOn`; the answer route (`engine/src/routes/answer-routes.ts`) | **Builds on.** A test answers through it, in process |
| The resume route (`resume-routes.ts`) | **Builds on**, for a developer's own `ctx.suspend` |
| `durability` · `resolveDurabilityProvider({ durable: true })`, the checkpoint provider | **Builds on.** `testFlow`'s default, as for any host |
| `createInProcessFetch`, `createFlowApiRouter` | **Builds on.** The in-process door the client's `fetcher` already uses |
| Other ways to answer a stop: the answer route, the resume route, the Inbox's answer call (orchestration), the engine's own suspend test harness (`engine/test/suspend-for-user.test.ts`). Searched `answer`, `resume`, `continueRequest`, `parkOnWait` across `packages/` | **None added.** The helper is a client of the first two. This would be the third *caller* of the answer route, after the client and the Inbox, not a third way |
| `testBlock`; `testSequencer`, `testRouter` | **Extends** `testBlock`; **removes** the two ([D3](DECISIONS.md#d3)) |
| Core's `Benchmark*` types (`core/src/benchmark/types.ts`); patterns' benchmark adapters | **Moved** to `testing/benchmark` and `patterns/benchmark` ([D2](DECISIONS.md#d2)) |
| [FIX-2063 D2](../FIX-2063/DECISIONS.md#d2): durable by default wherever stores persist, `durable: true` for tests | **Kept.** `testFlow` makes the test choice for the adopter |
| [FIX-2129 D2](../FIX-2129/DECISIONS.md#d2): an answer route beside resume | **Kept.** A test uses both as a screen does |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| `answer` and `resume` on `testFlow`'s result (each taking `headers` for a flow's own sign-in), and `suspension` | `suspension` · the answer and resume routes; the client's `answer` (FIX-2450) | Composed: each is one in-process call to its route. The testing package doesn't depend on the client, so it calls the route the client calls |
| A `durable` option on `testFlow` | `resolveDurabilityProvider`'s `durable` | The same name and meaning, passed through |
| `testing/benchmark`, `patterns/benchmark` | Each package's `exports` map; core's `./benchmark/types.ts` | Extends the maps. No new package |
| A repo-only `./bundle` entry on testing | Orchestration's `./inbox/check`, hidden by `publishConfig` | Epic D2's second kind, reused |

| The debt | |
|---|---|
| **Removes** | 21 benchmark and 3 scanner names from the testing root, 6 `Benchmark*` types from core's root, 8 benchmark names from patterns' root, `testSequencer` and `testRouter` and their result types |
| **Adds** | Two public subpaths to keep. Under Q1's alias option, deprecated aliases until the removal minor, owned by that removal |
| **Leaves** | A test helper with no request host for spawning or messaging (FIX-1293). The testing package marker, which the epic gives FIX-2449 with the other three |

**Net: down.** The testing root loses 28 of its 90 names, two other roots lose their benchmark names,
two helpers fold into one, and no answer path is added.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met):** a step that waits for a person, tested
from the installed tarball, answered through the engine's route, and a root with only test
helpers. If wrong: adopters still can't test the feature the window shipped.

**[The debt](#whats-already-here-and-the-debt), net down:** 38 root names move off three roots and two helpers fold;
two public subpaths are added. If wrong: benchmark users pay a move for nothing.

1. [D1](DECISIONS.md#d1) · **A test answers through the engine's answer route, in process.**
   If wrong: a test passes a stop a screen would have refused.
2. [D2](DECISIONS.md#d2) · **The benchmark contract moves to `testing/benchmark`, and patterns'
   adapters go to `patterns/benchmark` with it.** If wrong: patterns' types reach for a package
   its adopters didn't install.
3. [D3](DECISIONS.md#d3) · **`testSequencer` and `testRouter` fold into `testBlock`.** If
   wrong: four test files and two docs pages change for a naming preference.

**Open: none.** D1 is the one to weigh.

Improvement · `testing` + `core` + `patterns` (+ `cli`, `pattern-benchmark` imports) · medium:
three published packages, two subpaths, 38 names moved, two helpers folded, no engine change ·
epic [FIX-2447](../../epics/FIX-2447/SPEC.md)
