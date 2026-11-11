# FIX-2626 · An installable unit above a flow: defineKit with requires, slots, config and a client half

**Spec** · [Decisions](DECISIONS.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **packages a feature** (workforce, harness-manager) | Ships setup functions, and docs on how to wire them in order | Defines a kit: config, the kits it requires, the slots it declares, its folder, and an install that returns flows |
| **installs features into an app** | Wires each by hand, in an order they work out, with their own refusal for a bad tree | Lists one config object per kit, in any order. The framework orders them and fills each slot once |
| **adds to another feature** (the coding harness to workforce) | Passes one package's pieces into the other's setup, knowing both. Four hosts rebuild the readiness map, three the coding flow | Contributes into a slot the other kit declares. A duplicate key is refused, naming both kits |
| **puts a file in a kit's folder** | A file the docs don't name loads nothing and says nothing (claude-code-style's `workforce/flows/`, a stray file in `teams/`) | Every file is used or refused by path, and the app won't start until it's fixed ([D2](DECISIONS.md#d2)) |
| **builds a screen on a kit** | Writes an adapter. Workforce's React panels take rows the app builds, so no app imports them | Imports the kit package's views, hooks and components like any export. Views remove the read model: 12 of claude-code-style's 1,642 adapter lines need a kit ([D1](DECISIONS.md#d1)) |

## The goal, and how we'll know it's met

**A feature author ships a feature as a kit, and an app installs several kits in one list, in any
order: each kit gets what the kits that require it put in its slots, and every file in a kit's
folder is used, or the app refuses to start and names it.**

| Is it the right goal? | |
|---|---|
| **The real need** | The epic's FIX-2626 row, "the install half of the goal", and the unit FIX-2627 builds two kits on. O1's note: show what only a kit removes before the slot contract is built |
| **Smaller, and rejected** | "`kits` on `createFlowState` and the walker lifted, with workforce the only kit." Slots shaped for one consumer freeze wrong, and FIX-2622's sketch never ran `requires` ordering or a list merge |
| **Bigger, and not this issue's** | Workforce and harnesses as kits (FIX-2627); claude-code-style on kits (FIX-2628); a kit client runtime ([D1](DECISIONS.md#d1)); a registry ([FIX-147](https://linear.app/fixpoint-labs/issue/FIX-147)'s, canceled; the epic's non-goal) |
| **Not done if** | Breaking `requires` ordering or the list merge fails no test · a relative folder path in config reads against the app's folder, not the working directory · a refusal is only logged · workforce keeps its own walk primitives · a kit's browser entry pulls in `node:fs` · a kit fills a slot of a kit it doesn't require |

```mermaid
flowchart LR
  F["fixture app · three kits listed against their requires order"] --> R["fsdev run · the real install"]
  R -->|"every kit's flows served · slots filled in requires order"| P["PASS · goal met"]
  S["a stray file in a kit's folder"] --> R
  R -->|"refuses to start · names the file"| P
  C["control · install in list order"] -.-> R
  R -.->|"under the control"| X["must FAIL · the empty slot named"]
```

The check reads what the running app serves and refuses, never what `defineKit` returns.

| How we verify | |
|---|---|
| **Goal check** | `goals/kits/install-in-any-order/` (new), model `n/a`, run by the implementer with `fsdev run` at completion; verdict on the implementation PR |
| **Signal** | Kit `b` declares a keyed and a list slot and owns a folder; `c` requires `b`, `d` requires `c`; the app lists `[d, b, c]`. All flows served; `b`'s flow answers with `c`'s and `d`'s keyed entries and the list `[c, d]`. Three refusals, each named: `d` repeating `c`'s key; a stray `notes.txt` in `b`'s folder; a fill by a kit that doesn't require `b`. A relative folder path, run from another directory, reads that directory's folder |
| **Input** | The goal's fixture kits. Also valid: a fourth kit, no folder or slots, listed first |
| **Anti-game** | Assert on what the app serves and refuses. Never list kits in requires order: it hides an install in list order |
| **Control that must fail** | `GOAL_CONTROL=list-order`: `b`'s slot is empty, so the keyed-entries signal fails. `GOAL_CONTROL=skip-unknown`: the app starts beside `notes.txt`, so the stray-file signal fails |

## What changes

![Before: the host reads the tree, refuses it, installs and hires workforce, and spreads the flows by hand. After: the app lists kits; the engine orders them, merges slots, reads each folder through one walker and registers the flows](figures/what-changes.svg)

The host stops knowing the order and both packages' internals; the walker leaves workforce so
every kit reads its folder one way.

A host, and the two kits it installs (FIX-2627 writes the real ones):

```diff
- const roster = await readDeclaredRoster(options.tree ?? TEAMMATES_TREE);
- if (roster.problems.length > 0) throw new Error(`the workers did not load: …`);
- const installation = createWorkerInstallation({ standardWorkers: roster.workers, workerFlows: { agent: workerFlow(…) } });
- const copies = hireWorkforce(installation);
- createFlowState({ flows: Object.fromEntries([...copies, readiness, context].map((c) => [c.id, c])), stores });
+ createFlowState({
+   kits: [harnesses({ claudeCode: {}, codex: {} }), workforce({ directory: options.tree, model })],  // any order
+   flows: { [READINESS_FLOW]: readiness, [LAB_CONTEXT_FLOW]: context },                             // the app's own
+   stores,
+ });
```

```ts
export const workforce = defineKit({
  name: "workforce",
  config: z.object({ model: z.string() }),
  slots: { workerFlows: slot.keyed(workerFlowSchema) },
  directory: { path: "workforce", read: readWorkforceFolder },        // Node-only; runs at install
  install: ({ config, folder, slots }) => ({ flows: hire(folder, slots.workerFlows, config) }),
});

export const harnesses = defineKit({
  name: "harnesses",
  requires: [workforce],
  contributes: ({ config }) => ({ [workforce.slots.workerFlows]: { coder: coderFlow(config) } }),
  install: ({ config }) => ({ flows: [readinessFlow(config)] }),
});
```

**Docs:** create *Kits* in Core → Fundamentals, after *Capabilities*; API reference entries for
`defineKit` and `createFlowState`'s `kits`; the `core` and `engine` READMEs (the engine's new
Node-only folder subpath). Same PR: `docs/architecture/kits.md`, the package roles in
`overview.md`, a `kit` row in `docs/mechanisms/mechanisms.yaml`. This changeset carries the
epic's shared story to `/release-docs`; workforce's pages are FIX-2627's.

```mermaid
flowchart LR
  A["createFlowState · kits"] --> V["each kit factory · config checked"]
  V --> O["engine · order by requires"]
  O --> S["merge each slot · schema checked"]
  S --> W["engine folder walker · used or refused"]
  W --> I["each kit's install · existing pieces"]
  I --> G["flow registry · one per id"]
  W -.->|"any refusal"| X["ready rejects · app does not start"]
```

Up to the slot merge runs inside `createFlowState`; the folder reads and installs run before the
first request.

## What stays as it is

- **Capabilities**, the unit a block uses. A kit installs flows, which carry theirs.
- **`createFlowState({ flows })`**. Installs add to the same registry.
- **Resources and views**, declared on blocks and flows. A kit holds them through its flows.
- **`hireWorkforce` and `createWorkerInstallation`**, public until FIX-2627 makes them internals.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| **The job: put a feature's pieces into an app.** `capability` (one block), `workforce`, `worker-loader`; the engine's `flows`. Searching `packages/*/src` for `install*`, `create*Installation`, `mount*`, `*Plugin` found only `createWorkerInstallation` | **Builds on** `flows`, the closest: the third way to do the job, beside `flows` and a block's `uses`, composed on the first |
| [FIX-2618 O1](../../epics/FIX-2618/DECISIONS.md#o1), [ER-5](../../epics/FIX-2618/DECISIONS.md#who-owns-what) | **Builds** both. **Amends** O1's *Because* ([D1](DECISIONS.md#d1)), by an epic amendment not made here |
| [FIX-2622 Settled](../FIX-2622/DECISIONS.md#settled), its `define-kit.ts` | **Builds on** the sketch; **keeps** "a relative override reads against the working directory" |
| Workforce's loader rule: what the docs name is used or refused | **Extends** it to every entry. Today a folder's root entries have no reader, and a stray file in `teams/` is skipped ([D2](DECISIONS.md#d2)) |
| The concept doc's open item on refused files | **Answers** it ([D2](DECISIONS.md#d2)) |
| [FIX-1477 D1](../FIX-1477/DECISIONS.md#d1); [FIX-1655](https://linear.app/fixpoint-labs/issue/FIX-1655)'s registry copy-in | **Keeps** D1 for the library half; **reuses** the copy-in for `init` |

| Adds | Existing piece considered | Why it doesn't fit, or how it is composed |
|---|---|---|
| `defineKit`, slot types (`core`) | `capability` · `defineCapability`; `flow` · `defineFlow` | A capability installs into one block and can't add flows or declare slots. A kit's install returns flows |
| `kits` and install (engine) | The `flows` option and flow registry | **Extends:** the same registry, which refuses a duplicate id as today |
| Slots, keyed or list | `createWorkerInstallation`'s `workerFlows`; FIX-2622's sketch | New, as a contract across packages; the sketch is the start |
| The folder walker (Node-only engine subpath) | `worker-loader` · `openRoot`, `classify`, `openStructuralDirectory`, `refusedSymlink`, `unreadable`, `IGNORED_ENTRIES` | **Reuse**, lifted. It adds one pass: what no reader claimed is refused |
| The folder naming rule (`core` helpers) | `validateSegment`, `isWindowsReservedName` | **Reuse:** pure, and browser-safe workforce code calls it |
| `init` for a kit's folder | `fsdev ui add` (FIX-1655) | **Reuse:** starter files are registry items aimed at the folder; never overwrites |

| The debt | |
|---|---|
| **Removes** | Workforce's own walk primitives (moved, no alias, BP-034). Each host's tree read and refusal, once FIX-2627 lands. The two places a file is skipped silently |
| **Adds** | Kits and slots, a concept and a contract, permanent by design. A third way to do the job, which shrinks when `hireWorkforce` goes internal (FIX-2627). A Node-only engine subpath. Kit flows register at start-up, so `meta.flowKeys` lists them only after `ready()` |
| **Leaves** | The three adapters (follow-up epics). Workforce's folder constants (`RESOURCES_SLOT`, `PACKAGES_SLOT`), a third "slot": FIX-2627 owns that schema |

**Net: up, by one concept,** which the epic accepted; FIX-2627 pays the host side down.

## What FIX-2627 and FIX-2628 must agree with

| Issue | Must |
|---|---|
| **FIX-2627** | Claim every entry in workforce's folder, `workforce/flows/` included · route its readers and the `fsdev gen` walk through the claim pass · import the walk primitives from the engine, dropping them from `./loader` · declare the slots, with harnesses' keyed `harnesses` slot of `{ id, agent, readiness, pass, usage, models }` filled by two or more packages · views and hooks on a browser entry, components on `/react` · workforce's starter files · the third "slot" |
| **FIX-2628** | Build claude-code-style's kit on this `defineKit` · credit its adapter's removal per [the POC](poc/client-half/README.md), confirming or refuting the 12 kit-only lines |

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** several kits, any order, slots
filled across kits, every folder file used or refused. If wrong: a slot contract frozen on one
consumer, or ordering nobody ran.

**[The debt](#whats-already-here-and-the-debt), net up by one concept:** kits and slots added; a
private walker and each host's refusal removed. If wrong: a permanent contract only two kits use.

1. **[D1](DECISIONS.md#d1) · Kits are for composing features; a kit's client half is its
   package's ordinary exports, with no kit client runtime.** The one to weigh: it is where O1
   would reopen. If wrong: a client manifest is one field, added later.
2. **[D2](DECISIONS.md#d2) · Every file in a kit's folder is used or refused, and any refusal
   stops the app starting.** If wrong: a deploy fails on a file nobody meant to matter.

**Open: none.**

Feature · `core`, `engine`, `workforce` (walker moves out), `fsdev` (`init`) · M · epic
[FIX-2618](../../epics/FIX-2618/SPEC.md) stage 2 · [Linear](https://linear.app/fixpoint-labs/issue/FIX-2626)
