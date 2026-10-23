# FIX-2063 · Durable execution by default on file-backed hosts (dev, local runs, self-hosted)

**Spec** · [Decisions](DECISIONS.md)

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **runs `fsdev dev` with no config** | A flow that stops for a person fails: *"ctx.suspend() requires a DurabilityProvider"* | It stops; the DevTool answers it, after a restart too, and its deadline fires |
| **runs `fsdev run` with no config** | The same failure | The run exits 0 saying it waits, and to answer it in `fsdev dev`, which reads the same local database as the same local user ([D1](DECISIONS.md#d1)) |
| **self-hosts on SQLite or Postgres and never set `durable`** | Stops are refused until they find `durable: true` | Stops work; sequencers now checkpoint and a crashed request resumes; `durable: false` turns it off ([D2](DECISIONS.md#d2)) |
| **turned durability off, runs on in-memory stores, or built a router with no provider** | A generic error: *"Configure one in your server options"* | Refused at the stop, by an error naming the rule and the setting to change |
| **reads a no-config `fsdev run`'s state as JSON under `.fsdev/data`** | Works | Reads it from the SQLite file or through `fsdev dev`'s routes, or passes `--store filesystem` to keep the JSON files, single-process ([D1](DECISIONS.md#d1)) |
| **maintains the framework** | Hosts turn durability on case by case (Shift Manager's lab host, kitchen-sink, the goal hosts) | One default; those opt-ins go |

Suspension becomes the only way work stops for a person
([FIX-2058 D1](../../epics/FIX-2058/DECISIONS.md#d1)), so this issue is the epic's kill line.

## The goal, and how we'll know it's met

**On a local or self-hosted machine, with no configuration about durability, a flow that stops
for a person is held until that person answers or its deadline passes, across a restart, and is
answered from the same place whichever command started it.**

| Is it the right goal? | |
|---|---|
| **The real need** | *"Durable execution is on by default wherever stores persist: development, local runs and self-hosted servers"* (the issue). The epic: no park survives as a fallback, so the default carries every stop ([ER-6](../../epics/FIX-2058/DECISIONS.md#who-owns-what)) |
| **Smaller, and rejected** | "`durable` defaults to true" alone (not [D2's rejected branch](DECISIONS.md#d2)). Met while `fsdev run`'s stop sits in a store nothing answers, and while no sweeper runs, so deadlines never fire |
| **Bigger, and not this issue's** | One `waitForUser` call with a 7-day default deadline, and the Inbox answering it (FIX-2129). Serverless hosts (not a target) |
| **The hosts it covers** | `createFlowState` apps on file-backed stores (filesystem, SQLite, Postgres), served by `fsdev dev --app`, the node adapter's serve, or the next and vercel adapters; no-config `fsdev dev` and `fsdev run` |
| **Not done if** | A stop works only with an app config · a run's stop can't be answered after `fsdev run` exits · a deadline passes and nothing fires · a host without durability fails at some later step rather than at the stop |

```mermaid
flowchart LR
  A["a folder with no fsdev config · a flow that stops for a person"] --> L1["leg a · fsdev run · the run ends waiting"]
  L1 --> L2["leg b · start fsdev dev · restart it · answer through the resume route"]
  A --> L3["leg c · an approval past its deadline · while fsdev dev runs"]
  A --> L4["leg d · durable false · the same flow"]
  L2 -->|"same request completes · once"| P["PASS · goal met"]
  L3 -->|"expired within one sweep"| P
  L4 -->|"refused at the stop · names the setting"| P
  C["control · today's main"] -.-> L1
  L1 -.->|"under the control"| F["must FAIL · legs a and b"]
```

The check reads what the CLI printed and the records through the public routes. Today's `main`
must fail it, at the stop.

| How we verify | |
|---|---|
| **Goal check** | `goals/durable-by-default/a-local-stop-is-held-and-answered/` · no model · run by the implementer at completion · verdict in the implementation PR |
| **Signal** | a: `fsdev run` exits 0, printing the stop's id (in `--capture` too) and the answer hint; the request is `suspended`. b: after `fsdev dev` starts and restarts, the stop is listed in the DevTool's default session listing, under its default user; one approve completes that request id, once, and the step before the stop ran once in all. c: an approval whose deadline passes while `fsdev dev` runs is `expired` within one sweep. d: under `durable: false` the request fails at the stop, the error names the rule and the setting, no suspension or checkpoint is stored, and the request stays recorded as failed, as today |
| **Input** | A discovery folder with one flow: a step that counts its runs, an approval stop, then a step. An input stop must pass too, and so must an app config that never mentions `durable` |
| **Anti-game** | Real processes and SQLite file, public routes; no calls into the provider or sweeper. Legs a and b run a second time with `FSDEV_TRACE_OBSERVABILITY=0`, production's default, and the step before the stop still runs once |
| **Control that must fail** | Today's `main`: leg a on *the request is `suspended`*, leg c on *`expired` within one sweep* |

## What changes

![Four hosts, today and after. Today only a host that sets durable true holds a stop; fsdev dev and fsdev run with no config refuse it, and fsdev run writes to its own files. After, every host on persisting stores holds it by default; fsdev run and fsdev dev share one SQLite file, and the router's sweeper fires deadlines; durable false or in-memory stores refuse at the stop](figures/what-changes.svg)

Read across each row: who holds a stop today, then after.

**An app config, as a person writes it:**

```diff
  export default createFlowState({
    flows: { review },
    stores: { default: { primary: sqliteStores({ filename: "data/app.db" }) } },
-   durable: true,          // was needed before any stop worked
+   // durable by default; `durable: false` turns it off
  })
```

No-config `fsdev dev` and `fsdev run` change with nothing to write.

**Docs:** update *Advanced → Durable execution → Enabling durability* (on by default where
stores persist, the opt-out, what it costs, which hosts sweep, in-memory stores opting in for
tests), the `durable` row in *Configuration → Runtime*, *API → CLI* for `fsdev run`'s store, the
`--store filesystem` flag and its single-process limit, and the waiting report (its `.fsdev/data` lines too), the data lines in *DevTool → Setup* and
*DevTool → Overview*, and the engine README. A changeset carries the migration note: sequencers
checkpoint, a crashed request resumes, a raw `ctx.suspend()` is held, `durable: false` restores
today. No new page. FIX-2131 owns the stop's story.

## What stays as it is

- **What a stop is, and how it is answered.** FIX-2129 and FIX-2131 own both.
- **Action and sequencer `durable` flags**, the checkpoint provider and the sweeper's work.
- **The low-level router and `runAction`** take a provider only when given one; the hosts above get theirs from one engine rule.
- **Waits on a task** still refuse where no sweeper runs (FIX-1816). A person's stop is the exception, in `fsdev run` ([D3](DECISIONS.md#d3)).

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| `createFlowState({ durable })`, default `false` (`engine/src/flowstate/types.ts`) | **Extends.** Default `true` ([D2](DECISIONS.md#d2)) |
| Other ways to make a host durable: a provider on a router's config; each host's own `durable: true` | **Builds on** the first, for the CLI's router; **removes** the second. Searched `durable`, `durabilityProvider`, `createCheckpointDurabilityProvider` in `packages/`, `apps/`, `goals/`, `labs/`: a default, not a new way |
| The durability sweeper, built only by a router; `getRuntime()` hosts sweep nothing | **Builds on.** It stays the router's ([D3](DECISIONS.md#d3)) |
| No-config `fsdev run` on filesystem stores; `fsdev dev` and `fsdev chat` on `.fsdev/data/fsdev.db` | **Replaces** the first with the second ([D1](DECISIONS.md#d1)) |
| `ctx.suspend()`'s refusal without a provider | **Extends.** Its message names the rule and the host setting |
| `fsdev run`'s default user `cli-user`; the DevTool's `devuser` | **Replaces** the two with one local default ([D1](DECISIONS.md#d1)) |
| Sequencers default to `durable: true` (FIX-401), skipped today only for want of a provider | **Builds on.** They checkpoint wherever the default lands; the price of [D2](DECISIONS.md#d2) |
| [FIX-406](https://linear.app/fixpoint-labs/issue/FIX-406) 6A: `fsdev run` on the filesystem store, acknowledged development-only | **Superseded in part,** for no-config runs. Configured runs keep the app's stores |
| [FIX-2058 ER-6, D1](../../epics/FIX-2058/DECISIONS.md#d1) | **Kept.** This issue owns ER-6 |
| A resume replays finished steps from their traces, which production doesn't keep: with traces off, a resumed request runs them again ([FIX-2137](https://linear.app/fixpoint-labs/issue/FIX-2137)) | **Blocked by.** The default flip must not merge before FIX-2137 lands, or D2's crash-resume turns that bug on for every app that never opted in |

| The debt | |
|---|---|
| **Removes** | The per-host `durable: true` opt-ins, Shift Manager's conditional one included · host refusals that guard on it, such as the Error Reporter's · the docs' nonexistent `durabilityProvider` option |
| **Adds** | One fact on the in-memory store adapter: it does not persist. A `--store filesystem` flag on `fsdev run` and `fsdev dev`, the headless proposal's override (`docs/internal/fsdev-headless-verification-capabilities-design.md`), as D1's opt-back. No shim |

**Net: down.** A default replaces a dozen opt-ins and two refusals; one fact on one adapter and one opt-back flag are added beside it.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** held, answered in one place
whichever command started it, across a restart, with deadlines firing. If wrong: FIX-2129 to
FIX-2133 retire the parks onto a default that drops stops locally.

**[The debt](#whats-already-here-and-the-debt), net down:** the opt-ins go; nothing kept for
old callers. If wrong: a host somewhere relied on durability being off.

1. **[D2](DECISIONS.md#d2) · Durable by default wherever stores persist; in-memory stores and
   `durable: false` refuse at the stop.** If wrong: an app that upgrades checkpoints every
   sequencer step and resumes crashed requests it used to rerun.
2. **[D3](DECISIONS.md#d3) · The sweeper stays where a router runs; one-shot commands leave the
   stop to it.** Engineering, decided. If wrong: a deadline waits for the next server start.

**Decided by the owner (2026-10-23):** [D1](DECISIONS.md#d1), a no-config `fsdev run` uses
`fsdev dev`'s database and user, with `--store filesystem` as the opt-back.

**Open: none.** Number 1 is the one to weigh: an upgrade turns durability on for apps that never set it.

**Ordering:** the implementation that flips the default waits on [FIX-2137](https://linear.app/fixpoint-labs/issue/FIX-2137), a direct-route bug now in epic FIX-2058 and parented under it. It stays a hard blocker of the flip.

Improvement · `engine` + `fsdev` + docs · small · epic [FIX-2058](../../epics/FIX-2058/SPEC.md)
