# FIX-2460 · Decisions

[Spec](SPEC.md) · **Decisions**

What was considered, what was chosen, and what each choice locks in. D1 to D3 are the sign-off;
everything else is context for them.

## The tree

```mermaid
flowchart TD
  I["FIX-2460"] --> D1["D1 · answer through the engine's answer route, in process"]
  D1 -.->|"rejected · an engine export for tests, or continueRequest directly"| X1["a second door into the run"]
  I --> D2["D2 · benchmark contract to testing/benchmark · adapters to patterns/benchmark"]
  D2 -.->|"rejected · the types stay in core on a subpath"| X2["core keeps a benchmark vocabulary"]
  I --> D3["D3 · testSequencer and testRouter fold into testBlock"]
  D3 -.->|"rejected · keep three helpers"| X3["two names that differ only in result fields"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A test answers a stop through the engine's answer route, in process

| | |
|---|---|
| **Instead of** | Extracting the route's logic into an engine function the testing package calls, or resuming the run with `continueRequest` directly |
| **Because** | The route is where the checks live: who may answer, which actions the stop allows, the answer's schema, its deadline, *already resolved*, and the request's lease. Epic ER-6 sends the helper through the engine's answer path, and the in-process route is that path with no engine change. The POC ran it on entries the engine already exports ([Settled](#settled)) |
| **Locks in** | A test's answer meets every refusal a screen's does, and a change to the route reaches tests with no testing release. The test goes through the HTTP layer, so a flow with its own `authentication.resolvePrincipal` needs the test to pass what that resolver reads. `run.answer` and `run.resume` take `headers` for that |

**What would change my mind:** the route's timers or its 202-then-continue shape making tests
flaky in a way the helper can't wait out. Then an engine function the route also calls, which
FIX-2449's split would have to host.

![D1: through the answer route in process, chosen, beside an engine export or continueRequest directly. Decides it: whether a test meets the same refusals a screen meets. Price: the test runs the HTTP layer and must pass what a custom sign-in resolver reads. Tie: neither changes what the block receives. Locks in: one door into a parked run. Flips if: the route's timers make tests flaky](figures/d1-answer-route.svg)

It comes down to the refusals: a direct resume passes a second answer a screen gets refused.

<a name="d2"></a>
## D2 · The benchmark contract moves to `testing/benchmark`, and patterns' adapters go to `patterns/benchmark`

| | |
|---|---|
| **Instead of** | Keeping the six `Benchmark*` types in core, on a `core/benchmark` subpath, with patterns' eight adapters on its root |
| **Because** | The epic's seam gives the types to this issue for `testing/benchmark`. They have two kinds of consumer, both benchmark code: the engine in testing and the adapters in patterns. Patterns imports them from core only because testing is its dev dependency, so the types can move only if the adapters move to a subpath that may reference testing |
| **Locks in** | Core's and patterns' roots carry no benchmark names, and benchmarking is reached only through two subpaths. Patterns lists `@flow-state-dev/testing` as an optional peer dependency, read by `patterns/benchmark`'s types alone; an adopter who never imports that subpath installs nothing new. Changes FIX-2459's patterns root ([Decided](#decided-not-asked)) |

**What would change my mind:** the packed-install check showing that `patterns/benchmark`'s
types fail to resolve for an adopter without testing installed in a way an optional peer can't
fix. Then the types stay in core, on `core/benchmark`.

![D2: testing/benchmark with patterns/benchmark, chosen, beside the types on a core subpath. Decides it: whether core and patterns keep a benchmark vocabulary. Price: patterns takes an optional type-only peer on testing. Tie: fsdev benchmark behaves the same. Locks in: benchmarking only through subpaths. Flips if: the optional peer can't resolve the types for an adopter](figures/d2-benchmark-home.svg)

It comes down to vocabulary: on a core subpath, the framework's base package still names benchmarking.

<a name="d3"></a>
## D3 · `testSequencer` and `testRouter` fold into `testBlock`

| | |
|---|---|
| **Instead of** | Three block helpers, two of them `testBlock` plus extra result fields |
| **Because** | `testSequencer` is `testBlock` plus step traces read from the items; `testRouter` is `testBlock` plus the route a hook saw. They differ only in what the caller gets back, which `issue-spec` question 7 says is a parameter on the closest entry, not a second helper |
| **Locks in** | One helper per unit an adopter tests: `testBlock` for a block, `testFlow` for an action. `testBlock`'s result type depends on the block's kind. The two names retire per ER-3 / Q1's answer; four test files and their docs pages change |

**What would change my mind:** `testBlock` unable to type `steps` and `selectedRoute` by the
block's kind without a cast in the adopter's test. Then keep the two as typed wrappers.

![D3: fold into testBlock, chosen, beside keeping three helpers. Decides it: what an adopter picks between to test one block. Price: the two names retire, and four test files and their docs pages change. Tie: the same steps and route are returned. Locks in: one helper per unit. Flips if: the result can't be typed by kind without a cast](figures/d3-one-block-helper.svg)

It comes down to the pick: three names for one job is the choice the epic exists to remove.

## Decided, not asked

- **Durable by default, in memory.** `testFlow` passes `durable: true` unless the test says
  `durable: false`: FIX-2063 D2's name and its test case. A flow that failed on
  `suspendForUser` now parks, which is the point.
- **One runtime config** carries the mocks, settings and durability into both the first run
  and every continuation, so a generator after an answer uses the test's mocks.
- **The verb and its arguments are FIX-2450's.** `run.answer({ action, data? })` mirrors the
  client's `answer`; `suspensionId` defaults to the run's one pending stop and is required when
  there are several. `run.resume` mirrors the client's `resume`, for a developer's own
  `ctx.suspend`. This issue is blocked by FIX-2450 for the name.
- **What `answer` returns** is the same `TestFlowResult` shape, for the same request: status,
  output and the items of the run that followed. A refusal throws an error carrying the route's
  status and message.
- **Convergence point:** every answer or resume in a test goes through its engine route. The
  only writers are `run.answer` and `run.resume`; neither calls `continueRequest`.
- **No timer outlives `testFlow`.** The router is built for an answer and disposed when the run
  it continues settles.
- **The scanners** (`findImportsFromEntry`, `findNodeBuiltinsFromEntry`) move to a `./bundle`
  entry hidden by `publishConfig`, epic D2's second kind. All four importers are repo tests.
- **Moved and retired names follow ER-3 / Q1's answer**: the benchmark names, the core types,
  the patterns adapters, the scanners and the two folded helpers. Under the alias option each
  stays on its root as a deprecated alias naming its new home until the removal minor; under the
  others it goes. The direction holds either way.
- **The goal check's rows.** The closure manifest's *One path* row gains this issue's leg c
  assertion (proposed id `testing-answers-a-stop`) and *Surface* its census of the testing and
  core roots; FIX-2564 names the ids, and this issue's PR flips them to `expect: pass`.
- **Seams.** FIX-2448 lands first on `core/src/index.ts`; this issue removes the six types from
  its split. Moving the adapters touches patterns' root, FIX-2459's surface: this issue edits
  only the benchmark block. The testing package marker is FIX-2449's, with the other three.
- **Changesets** per ER-7: testing, core and patterns, one line each naming the new homes.

## Considered and dropped

| Option | Why it lost |
|---|---|
| Build `testFlow` on `createFlowState` | Its stores option is profile-based and can't take the test's registry, so a shared `stores` across runs breaks |
| An `answerSuspension()` engine export | The same checks as the route, plus a new engine export on FIX-2449's root, for no gain the POC didn't already show |
| The scanners in a private workspace package | A new package for two functions, when epic D2's hidden entry already exists |
| Durability opt-in (`durable: true` to turn it on) | A test would run a different engine from production's default, and an adopter would need to know durability exists to test an approval |

## Open / settled

<a name="settled"></a>
**Settled · CONFIRMED · [answer-in-process](poc/answer-in-process/README.md).** On `main` at
`d6a38c09`, using only engine root exports: an action that calls `suspendForUser` parks over
in-memory stores; the answer route, through `createInProcessFetch`, resumes it to `completed`
with the step's output; a second answer is refused *already resolved*; a developer's
`ctx.suspend` resumes through the resume route. Controls: today's `testFlow` fails the same flow,
and a router without durability refuses the answer.

**Settled · [surface-census](poc/surface-census/README.md).** Every count in the spec, from
source, with a totality assertion over the testing root that failed on a real omission first and
fails on a planted name.

**Open: none.**

## Analysis

Run by the epic-agent over the whole spec set, with `reuse-review` on *Builds on / Adds*.

## How it got here

- **Draft** — framed as the epic's fourth team: a step that waits for a person can't be tested,
  and the testing root mixes benchmark and repo tooling into adopter helpers. The answer goes
  through the engine's own route in process, built on checkpoint durability; benchmark and
  scanner names leave three roots for subpaths; two block helpers fold into one.
