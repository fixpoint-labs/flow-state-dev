# FIX-2141 · Codex: read subscription usage from app-server and define the usage snapshot

**Spec** · [Decisions](DECISIONS.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **runs Shift Manager on their own ChatGPT sign-in** | Can't see how much of Codex's 5-hour or weekly window is left until a run fails | Opens Usage and sees each Codex window: percent used, when it resets, "from Codex", checked a few seconds ago |
| **opens Usage again an hour later** | Nothing to open | Sees the number refresh. A window whose reset time has passed shows "reset at 14:00, not checked since", never the old percent |
| **runs Codex with an API key** | Nothing | Sees "Codex uses an API key: no subscription limit". No percent |
| **has never signed Codex in on this machine** | Nothing | Sees "Codex is not signed in: not available automatically". No percent, no guess |
| **builds a screen or a worker that needs usage** | Would have to call Codex itself | Calls one query, `harnessUsage`, and gets the same rows and ages the Usage view shows |

## The goal, and how we'll know it's met

**A person running Shift Manager on their own subscription sees, for Codex, the percent used and
reset time of every window Codex reports, with where it came from and how old it is; and anything
that wants those numbers reads them through one query that Claude Code and the others will reuse.**

| Is it the right goal? | |
|---|---|
| **The real need** | *"Work fails with no warning when a pool runs out, and we can't plan which harness to use"* (the epic). *"A clean way to query usage at any point"* (Jake, on the epic) |
| **Smaller, and rejected** | "Show Codex's numbers on one screen." It would meet the first quote and miss the second: the next harness would invent its own store and its own read, which is the duplicate the epic's storage note forbids (FIX-2056 bar) |
| **Bigger, and not this issue's** | Claude Code's numbers (FIX-2142, writes the same snapshot). Tokens per worker, labelled as usage (FIX-2145). Cursor and Grok Build (FIX-2143, FIX-2144, on hold) |
| **Not done if** | A stale number reads as current · a window past its reset shows its old percent · signed out or API key shows any percent · a screen or worker reads Codex directly · the query and the screen can disagree · the snapshot has a second home |

```mermaid
flowchart LR
  A["Shift Manager served · real codex app-server"] --> L1["leg a · signed in · scripted app-server answers"]
  A --> L2["leg b · signed out · real CLI"]
  A --> L3["leg c · API key · real CLI"]
  A --> L4["leg d · a stored row past its reset"]
  A --> L5["leg e · read without refresh"]
  A --> L6["leg f · Jake's own sign-in · owed by a person"]
  A --> L7["leg g · the reader times out · two looks in a minute"]
  A --> L8["leg h · signed in, then an API key"]
  L1 --> R["the query's rows · the Usage view in a browser"]
  L2 --> R
  L3 --> R
  L4 --> R
  L5 --> R
  L6 --> R
  L7 --> R
  L8 --> R
  R -->|"a f windows with age · b c a reason, no percent · d rolled over · e no vendor call · g one child · h no old percent"| P["PASS · goal met"]
  R -.->|"control · the query ignores reset and age"| F["must FAIL legs d e"]
  R -.->|"control · unavailable reads as zero"| F2["must FAIL legs b c"]
  R -.->|"control · the throttle ignores failures"| F3["must FAIL leg g"]
  R -.->|"control · rows keyed by account"| F4["must FAIL leg h"]
```

The check reads what the query returns and what the Usage view draws. Each control must fail,
or the check proves nothing.

| How we verify | |
|---|---|
| **Goal check** | `goals/shift-manager/it-shows-codex-usage-left/` · no model · run by the implementer at completion · verdict in the implementation PR |
| **Signal** | a: two windows (300 and 10 080 minutes) with the scripted percents and resets, `checkedAt` within the run, and the view shows both with "from Codex"; a reading older than the stored one leaves the stored one. b: `signed-out`, the reason shown, no percent anywhere on the card. c: `api-key`, the same. d: a row whose `resetsAt` is past returns `rolledOver: true` and the view shows no percent for it. e: a row 3 hours old returns `ageMs` ≥ 3 h and the scripted app-server logs no read. g: a reader that hangs past its 10 s timeout, looked at twice in a minute and from two tabs at once, starts one child, and both looks return the stored row with a plain `refreshError`. h: after a signed-in read, the same person moves to an API key and refreshes; the query returns one Codex row, `api-key`, and no percent from the earlier account. f: Jake's real sign-in shows the same percents as `codex` `/status` within the same minute |
| **Input** | Legs b and c run the real `codex app-server` from the pinned `@openai/codex` (0.152.1) against an empty and an API-key `CODEX_HOME`. Leg a replays the protocol shape the pinned CLI's `generate-ts` publishes |
| **Anti-game** | No assertions on the reader's input or on a stubbed query. Rows read through the query over HTTP, the view read in a browser |
| **Control that must fail** | `GOAL_CONTROL=ignore-age` must FAIL d on *rolled over* and e on *no vendor call*. `GOAL_CONTROL=unavailable-as-zero` must FAIL b and c on *no percent*. `GOAL_CONTROL=last-write-wins` must FAIL a on *leaves the stored one*. `GOAL_CONTROL=throttle-ignores-failures` must FAIL g on *one child*. `GOAL_CONTROL=key-by-account` must FAIL h on *no percent from the earlier account* |

Leg f needs a ChatGPT sign-in, which no CI has. Until Jake or `fsd-qa` runs it, the signed-in
parse is proven against the CLI's published type only, and the implementation PR says *goal met
except leg f*.

## What changes

![Before and after. Today nothing reads Codex's limits. After: the host registers a Codex reader; one usage collection per person holds one current record per harness; the one query reads it, refreshes Codex first when asked, and returns each window with its age; the Usage view and any worker read only the query. Claude Code's writer, FIX-2142, plugs into the same collection](figures/what-changes.svg)

One store per person and one query in front of it. Codex fills it when someone looks; Claude Code
will fill it as runs report.

```diff
 // packages/shift-manager/teams/devteam/fsdev.config.mts (the host)
+import { readCodexUsage } from "@flow-state-dev/codex";
+import { harnessEnv } from "@flow-state-dev/core";
 …
 const lab = await openLab({
   stores: sqliteStores({ filename: STORE }),
   harness: harness.slot,
+  // Read when someone opens Usage. Local only: OpenAI does not permit app-server auth in a hosted service.
+  usage: { codex: () => readCodexUsage({ env: harnessEnv({ pass: ["PATH", "HOME", "CODEX_HOME"] }) }) },
   …
 });
```

`openLab` puts harness-manager's `harnessUsageAction({ readers })` on the one flow Shift
Manager reads first, so the browser and a worker call one address. A host outside Shift Manager
puts the same action on a flow of its own.

```ts
// any reader, server side or through the client
const { harnesses } = await harnessUsage({ refresh: true });
// [{ harness: "codex", status: "windows", plan: "pro",
//    windows: [{ minutes: 300, usedPercent: 42, resetsAt, checkedAt, ageMs, rolledOver: false, origin: "read" }, …] }]
```

**Docs:** update *Tools → Codex* (reading usage left, local only), *Tools → Coding agents* (the
shared usage shape), *Orchestration → Harness manager* (the usage collection and query), and the
READMEs of `core`, `codex`, `harness-manager` and `shift-manager`. No new page.

## How a number gets to the screen

```mermaid
flowchart LR
  V["Usage view · a worker"] --> Q["harnessUsage query"]
  Q -->|"refresh asked · last attempt a minute old"| R["registered reader · readCodexUsage"]
  R --> S["codex app-server · account/read · account/rateLimits/read"]
  S --> W["recordHarnessUsage · the one writer"]
  W --> C["user-scoped collection · harness-usage"]
  Q --> C
  C -->|"rows · ageMs · rolledOver"| V
  H["FIX-2142 · a Claude run's rate_limit_event"] -.-> W
```

The query is the only reader and `recordHarnessUsage` the only writer. Nothing else opens the
collection.

## What stays as it is

- **The Codex harness.** Runs still go through `@openai/codex-sdk`. Reading usage starts its own
  short-lived `codex app-server` and never touches a run.
- **The harness contract.** `HarnessRunHandle` and its `usage` and `cost` fields are unchanged.
  The new shape sits beside them.
- **The run record.** `runs/**` keeps its per-attempt tokens and cost. Totals per worker are
  FIX-2145's.
- **Credentials.** Nothing reads a token file or calls an undocumented endpoint. The reader
  asks the Codex CLI, as `probeClaudeAccount` asks Claude Code.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| Ways to read a vendor's subscription usage | **None.** Searched `rateLimit`, `rate_limit`, `usedPercent`, `utilization`, `quota`, `usage` across `packages/` and `apps/`: hits are per-run token counts and provider error codes. This is the first |
| Ways to hold host-wide harness facts per person | **One:** harness-manager's `user`-scoped run record (`runs/**`). **Builds on** its scope and principal; a second collection beside it, not a second mechanism |
| `probeClaudeAccount` (claude-code), which asks the harness's own CLI with no model turn | **Builds on** its shape for `readCodexUsage` |
| Kitchen-sink's Codex checks: `codexProgram` finds the CLI, and `codex login status` asks whether it is signed in (`apps/kitchen-sink/lib/codex-mode.ts`) | **Moves** the program lookup into `@flow-state-dev/codex`, where kitchen-sink imports it. **Leaves** `login status` as kitchen-sink's start-up gate: it answers "can a run start?", and `account/read` answers "is there a subscription number?". They agree on a sign-in, and an API key in the run's environment passes the first and is `api-key` to the second |
| `HarnessSessionHook` in `core/types/harness.ts`, fired by a harness during a run | **Leaves alone.** Its usage twin is FIX-2142's |
| The harness-manager slot feeds (`cwd`, `resume`, `onSession`) | **Leaves alone.** FIX-2142 adds `onUsage` with its first writer |
| harness-manager's `inbox/**`, the other `user`-scoped neighbour, and its named limit that `user` scope is not tenant-qualified | **Builds on** its settings (`flowIsolation: false`, lazy prefetch) and **inherits** the limit, named on [D1](DECISIONS.md#d1) |
| Shift Manager's gap for a task's harness, tokens and cost (FIX-1652) | **Leaves alone.** Per-task cost is that issue's; per-worker totals are FIX-2145's |

| The debt | |
|---|---|
| **Removes** | Kitchen-sink's own copy of the Codex program lookup, which moves into `@flow-state-dev/codex`. There was no usage read to replace |
| **Adds** | One collection, one writer, one query action, one Codex reader, one neutral type and reader signature. A Codex app-server child process per refresh, at most once a minute ([D2](DECISIONS.md#d2)). Permanent by design |
| **Leaves** | Workforce's Error Reporter runs Claude Code outside harness-manager, so FIX-2142 decides whether its `rate_limit_event`s are recorded. `user` scope is not tenant-qualified, the limit harness-manager's inbox already names |

**Net: up, small.** A new collection with one read and one write, and no second way to hold
state.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** Codex's windows on screen,
and the one query every harness reuses. If wrong: Claude Code arrives with its own store, and the
two can disagree.

**[The debt](#whats-already-here-and-the-debt), net up, small:** one collection and its query,
beside the run record. If wrong: a store nothing reads but one screen.

1. **[D1](DECISIONS.md#d1) · Usage is kept per person, in one collection, and read through one
   query that always returns its age.** The one to weigh. If wrong: two people on one machine see
   different ages for one shared Codex pool, and where one user id spans two tenants both see its
   plan (no email is stored).
2. **[D2](DECISIONS.md#d2) · Codex is read when someone looks, at most once a minute, not kept
   live.** If wrong: a run eats the window between looks, and the view is a minute behind.

D1 and D2 rest on Codex's signed-in answer as its CLI publishes it; leg f proves it live.

**Open: none.** `fsd-architect` agreed with the collection's home on
[agent-mailbox#45](https://github.com/fixpoint-labs/agent-mailbox/pull/45#issuecomment-6372035349);
three of its four rules are folded in, and the fourth is declined with the reason in
[Decisions](DECISIONS.md#how-it-got-here).

Feature · `core` + `codex` + `harness-manager` + `shift-manager` · medium · first child of epic FIX-2139
