# FIX-2618 · An app installs a feature and reads it back without an adapter

**Spec** · [Decisions](DECISIONS.md)

## Five teams, before and after

| A team that… | Today | After this epic |
|---|---|---|
| **builds an app on workforce** (a lab, Shift Manager) | Writes 1,100 to 1,800 lines of adapter to read workforce back: watch loops, caches, row assembly, and types that copy what the server computes | Installs workforce and the coding harness, calls their hooks, and gets types from the views. What's left is the app's own screens and renderer |
| **shows user- or org-level data** (pins, projects, a dashboard) | Makes a session only so it can read (`ownSession`, `labSession`, the roster session, `readerSessionId`) | Reads by scope and key with no session, and writes by sending an action to the resource |
| **installs workforce into a host** | Passes a circular `workerFlows: () => flows` callback, spreads the flows map by hand, casts with `as never`, adds a flow per read | Puts one config object per kit in `kits: [...]` |
| **keeps a screen current** | Learns which topics to watch and copies the re-read logic (three copies, FIX-2551) | Watches a view. A notice says which rows changed |
| **maintains the framework** | Two hooks compute a screen's answer (flow `reads`, scope `derived`); eight client read paths | One hook, the view. Nothing is added beside it |

**Why now.** The objective's kill line has fired. The labs and Shift Manager are the first real
apps on workforce, and each composes it only through a large adapter: Shift Manager's
`lib/reads.ts` is 1,109 lines, claude-code-style's `adapter.ts` 1,498, teammates' 1,788. That is
what the composition model costs today, and FIX-2592, FIX-2616 and FIX-2369 are about to add to
it. FIX-2152 ER-1 already says an app is configuration, UI and small flows; nothing in the
framework lets an app meet it.

## The goal, and how we'll know it's met

**An app on workforce is configuration, UI and small flows: it installs workforce and the
coding harness as kits and reads everything it shows through their views and direct resource
reads, with no hand-written read model and no session made only to read.**

| Is it the right goal? | |
|---|---|
| **The real need** | The kill line: the block kinds compose into real apps only through per-app glue. The need is to stop writing the glue, not to write it faster |
| **Smaller, and rejected** | "Views and direct reads ship." The adapter shrinks, but every host still assembles workforce by hand, and the next feature is wired the same way. Or "kits ship with workforce as the only one": slots designed for one consumer freeze the wrong contract |
| **Bigger, and not this epic's** | A third-party ecosystem (publishing, discovery, versioning, a registry). Moving Teammates' and Shift Manager's remaining adapters onto kit clients. Serving each answer on one route only. Each its own epic |
| **Not done if** | claude-code-style keeps a file that assembles server data by hand · any of the four own-session helpers survives · a host keeps `workerFlows: () =>` or `as never` · `reads` or scope `derived` is still exported · a view reads something it did not declare and no test fails · ids reach a client before the owner amends FIX-2367 D2 and FIX-2428 D2 · a bug the closure run found is open |

```mermaid
flowchart LR
  M["main · every child merged"] --> A["leg a · claude-code-style on kits · real model · browser"]
  M --> B["leg b · teammates host on the same kits"]
  A -->|"thread, coding task, board row, pin · all on screen · inventory clean"| P["PASS · the epic's goal is met"]
  B -->|"no callback, no casts, no coder.ts routing"| P
  C["control · today's main"] -.-> A
  A -.->|"under the control"| F["must FAIL · inventory refuses adapter.ts"]
```

Leg b is the one the smaller goal skips: a second app on the same kits is what shows the slots
are not shaped for one consumer. Under today's `main` the inventory must refuse the adapter,
which is what makes the PASS mean something.

| How we verify | |
|---|---|
| **Goal check** | The closure issue's goal check (FIX-2629), real model, in a browser, on one `main` commit after every other child merges. Its clean run is the epic's wrap condition |
| **Signal** | Leg a: a thread, a delegated coding task, its board row changing, and a pin, all seen on screen, with FIX-2152 ER-1's inventory passing and no file that assembles server data. Leg b: the teammates host installs workforce and the harness kit, and its own routing flow is gone |
| **Input** | A held-out coding prompt in a scratch repository, chosen at run time |
| **Anti-game** | Don't assert on a view's own output or a kit's unit tests: they pass while a screen still reads through a hand-rolled session. Assert on the screen and on the inventory |
| **Control that must fail** | Today's `main`: the inventory refuses `adapter.ts` and the own-session helpers. A view with one dependency left out: the development-time check fails |

## What's in the box

![In the box: views, one live read, resources by scope, writes to the runBy session, ids on notices, kits, and the workforce and harness kits. Fence: a view never writes, a client writes only through a block in the resource's session, a notice carries ids not rows, a kit reaches another only by slots. Composed in: the app's local kit, its screens, one config per kit. Replaced in one line: reads and derived by a view, own sessions by a direct read, host wiring by kits, row types by ViewOutput. Not built: a third-party ecosystem, generic client writes, the other two adapters, one route per answer](figures/end-state.svg)

Inside the box is what an app on workforce gets for one line of config. The fence is what keeps
it safe: every byte a client sees still comes through a checked read, and every write still
runs a block ([ER-2, ER-4](DECISIONS.md#who-owns-what)). The bottom strip is what the set
refuses to build.

**Docs:** the shared story is "a feature installs as a kit; a screen reads its views". FIX-2619
writes it as a concept doc first, and the architecture docs it names. FIX-2626's changeset
carries the published story to `/release-docs`; each child documents its own specifics. Worked
code for every piece is in [`examples/`](examples/), each marked proposed.

## The set · as of 2026-11-08

The reviewed snapshot. Live state is on [FIX-2618 in Linear](https://linear.app/fixpoint-labs/issue/FIX-2618).
Stage 1 is specced in the first spec-set PR and stage 2 after it lands ([D2](DECISIONS.md#d2)).

| Issue | What it delivers | Why the set needs it | Status |
|---|---|---|---|
| [FIX-2619](https://linear.app/fixpoint-labs/issue/FIX-2619) · stage 1 | The concept doc; glossary entries for view, the unit and slot; the narrowed objectives line; the architecture doc debt | Every spec reads one written model; the names land before code | Backlog |
| [FIX-2620](https://linear.app/fixpoint-labs/issue/FIX-2620) · stage 1 | Proof: a user-scoped view answers with no session | `runRead` takes a `sessionId` today; views and direct reads rest on this | Backlog |
| [FIX-2621](https://linear.app/fixpoint-labs/issue/FIX-2621) · stage 1 | Proof: `dependsOn` checked against what a view reads | The name "view" is earned only if declared dependencies can't drift silently ([O2](DECISIONS.md#o2)) | Backlog |
| [FIX-2622](https://linear.app/fixpoint-labs/issue/FIX-2622) · stage 1 | Proof: the teammates host with workforce as a kit | The collapse trigger for the kit children ([D1](DECISIONS.md#d1), [O1](DECISIONS.md#o1)) | Backlog |
| [FIX-2551](https://linear.app/fixpoint-labs/issue/FIX-2551) · stage 2 | One live read in the client: the coalescer and the path rule | `useView` and every package watch sit on it | Backlog · existing issue, now parented |
| [FIX-2623](https://linear.app/fixpoint-labs/issue/FIX-2623) · stage 2 | Views replace reads; `useView`, `ViewOutput`; `derived` folds in; board and roster move | The read half of the goal | Backlog |
| [FIX-2624](https://linear.app/fixpoint-labs/issue/FIX-2624) · stage 2 | Direct user and org reads; `runBy` writes; a session-free identity read; the four workarounds deleted | The session half of the goal | Backlog |
| [FIX-2625](https://linear.app/fixpoint-labs/issue/FIX-2625) · stage 2 · **gated** | Ids on notices | Re-reads only what changed. Specced only after [O4](DECISIONS.md#o4) is answered | Backlog |
| [FIX-2626](https://linear.app/fixpoint-labs/issue/FIX-2626) · stage 2 | `defineKit`, `requires`, slots, config, the client half | The install half of the goal | Backlog |
| [FIX-2627](https://linear.app/fixpoint-labs/issue/FIX-2627) · stage 2 | Workforce and the harnesses as kits; one shared coding worker flow | Two kits, so slots meet a second consumer before they freeze | Backlog |
| [FIX-2628](https://linear.app/fixpoint-labs/issue/FIX-2628) · stage 2 | claude-code-style on kits | The worked example made real; it measures the estimates | Backlog |
| [FIX-2629](https://linear.app/fixpoint-labs/issue/FIX-2629) · closure · **required** | The QA run on one `main` commit: both legs, each team's journey, every child's goal check, the seams | The only child that proves an app sheds its adapter | Backlog · blocked by every other child |

0 done · 12 open. Three proofs, one doc, seven build children, one closure. Whether twelve is
really fewer: FIX-2625 is the one to cut, since the goal is met without it; it stays because the
re-read cost lands on every view, and it is gated rather than dropped. **Collapse trigger:** if
FIX-2622 shows the wiring pain is workforce's own API, FIX-2626 to FIX-2628 leave for a
follow-up epic and FIX-2629 drops leg b.

## How the issues flow into each other

```mermaid
flowchart LR
  X["FIX-2367 · the bus and client.subscribe · consumed"] -.-> L
  D["FIX-2619 · concept doc"] -->|"the model and the names"| P["FIX-2620 / 2621 / 2622 · three proofs"]
  P -->|"a no-session read, the dependency check"| V["FIX-2623 · views"]
  L["FIX-2551 · one live read"] -->|"the coalescer"| V
  P -->|"the no-session context"| R["FIX-2624 · resources by scope"]
  V -->|"view notices and keys"| I["FIX-2625 · ids · gated"]
  V -->|"views to install"| K["FIX-2626 · kits"]
  R -->|"runBy resources"| K
  K -->|"defineKit and slots"| W["FIX-2627 · workforce and harness kits"]
  W -->|"the kits and their views"| C["FIX-2628 · claude-code-style"]
```

An edge is what one issue hands the next. A dashed input is consumed, not owned, and never
re-parented. Every child blocks the closure FIX-2629, which is left off to keep the graph
readable. The doc goes first; the proofs run in parallel; views and resources build in parallel
once the proofs land; kits come last because they package everything before them ([D2](DECISIONS.md#d2)).

## What stays as it is

- **Session-scope content writes.** `client.content.*` on session collections (FIX-296) stays as
  it is. The epic only declines to widen generic client writes ([ER-4](DECISIONS.md#who-owns-what)).
- **Session items, streams and the transcript.** A transcript belongs to one session; those
  routes keep their session address.
- **Capabilities.** Still the unit a block uses. A kit carries them; it doesn't replace them.
- **The push channel itself.** FIX-2367's bus, socket and `client.subscribe` are consumed as built.
- **FIX-2471's webhook routing, FIX-1907's harness mode, FIX-2615's connectors.** Coordinated,
  not folded ([DECISIONS → seams](DECISIONS.md#coordination-seams)).

## What's already here, and the debt

| Already here | What the set does with it |
|---|---|
| Flow `reads` ([FIX-2286 D1](../../issues/FIX-2286/DECISIONS.md#d1)): "the one hook for watching a computed view" | **Amended, revisited by the owner's leave.** The rule is kept (one hook, no writes); the hook is renamed to view and gains scope, `dependsOn` and `key` ([O2](DECISIONS.md#o2)) |
| Scope `derived` (two kitchen-sink flows) | **Superseded.** Folds into views (FIX-2623) |
| A notice carries no rows ([FIX-2367 D2](../FIX-2367/DECISIONS.md#d2)) | **Kept.** Ids are not rows; every byte still comes through a checked read |
| One hour of notices after revocation ([FIX-2428 D2](../../issues/FIX-2428/DECISIONS.md#d2)) | **Revisited** ([O4](DECISIONS.md#o4)). The window was safe because notices were empty; with ids it leaks which ids change. Its reason (a check per notice is a store read per viewer) is kept |
| Client writes off on the rules record ([FIX-1945 D1](../../issues/FIX-1945/DECISIONS.md#d1)) | **Kept.** Writes still run through the owning flow's blocks |
| A worker is a private resource run by the flow it names ([FIX-1788](../../issues/FIX-1788/SPEC.md)) | **Generalized.** `runBy` is that pattern for any resource ([O3](DECISIONS.md#o3)) |
| One adapter per lab, fixtures first ([FIX-2152 D4](../FIX-2152/DECISIONS.md#d4), ER-5) | **Superseded for claude-code-style** by FIX-2628; its ER-1 is this epic's goal |
| "Session factory… never a kit" ([FIX-2246](https://linear.app/fixpoint-labs/issue/FIX-2246), glossary) | **Narrowed** to the session-factory sense by FIX-2619 ([O5](DECISIONS.md#o5)) |
| A plugin system ([FIX-147](https://linear.app/fixpoint-labs/issue/FIX-147), canceled) and the objectives non-goal "Plugin/extension ecosystem" | **Kept out.** A kit is FSD's own composition unit; the third-party ecosystem stays a non-goal, and FIX-2619 narrows the line to say so |
| FIX-2369's FIX-2374 `sessionFeed`, FIX-2379 task-row view, FIX-2412 `watchRoster` | **Builds on.** Re-expressed as views, not duplicated |
| FIX-2036's deferred "Workforce browser contract for Shift Manager reads" (overlaps FIX-1672) | **Absorbed.** The workforce kit's views and client half are that contract |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| Views (FIX-2623) | Flow `reads`, scope `derived` | **Extends** reads; removes `derived`. Still one hook ([ER-1](DECISIONS.md#who-owns-what)) |
| `runBy` and `fsd.resource(ref).send` (FIX-2624) | FIX-1788's worker; `client.content.*`; actions | **Extends** the worker pattern; a send is an ordinary action on the resource's session, so no write route is added |
| A session-free identity read (FIX-2624) | The principal resolver, push topics | **Reuse:** the same verified principal the push topics use |
| Ids on notices (FIX-2625) | FIX-2367's notice shape | **Extends** the notice with an optional field |
| `defineKit` and slots (FIX-2626) | `defineCapability`, `defineFlow`, workforce's `createWorkerInstallation` | **Genuinely new.** A capability installs into a block and can't add flows or views; a kit holds only those existing pieces ([ER-5](DECISIONS.md#who-owns-what)) |
| One shared coding worker flow (FIX-2627) | claude-code-style's `harness-thread.mts`, teammates' `coder.ts`, `harness-manager` | **Reuse and merge:** two copies of the same routing become one |

| The debt | |
|---|---|
| **Removes** | About 1,250 lines of claude-code-style's adapter (estimate); three of its flows; four own-session helpers; two read-only flows in each lab host; scope `derived`; three coalescer copies; one duplicated coding flow |
| **Adds** | Kits and slots: a new concept and a public contract, permanent by design. `runBy` session lifecycle (creation races, deletes, a flow that's gone) |
| **Leaves** | Teammates' and Shift Manager's remaining adapters, and the same data served on two routes. Both named as follow-up epics, filed at wrap |

**Net: down.** Each app sheds its read model; the framework gains one concept and one contract.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** claude-code-style sheds its
adapter on kits, and teammates installs the same kits. If wrong: we ship views and direct reads,
and every app still hand-wires the next feature.

**[The set's debt](#whats-already-here-and-the-debt), net down:** apps shed their read models; the
framework gains kits and slots. If wrong: a slot contract that is hard to change, which
[D1](DECISIONS.md#d1)'s collapse trigger and FIX-2627's second kit exist to catch.

1. **[D1](DECISIONS.md#d1) · Four changes in one epic, proofs first, now.** If wrong: a large
   epic where four smaller ones would have shipped sooner.
2. **[D2](DECISIONS.md#d2) · The build children are specced after the proofs, in a second
   spec-set PR.** If wrong: the build waits a few weeks it didn't need to.
3. **[D3](DECISIONS.md#d3) · Lab adapters stop growing at this merge.** If wrong: sibling lab
   epics write package reads a little early.

**Open: five holds for the owner**, hardest first, each revisiting a sign-off with its reason
kept: [O1](DECISIONS.md#o1) kits as a unit · [O2](DECISIONS.md#o2) views replace reads ·
[O3](DECISIONS.md#o3) direct reads, `runBy` writes · [O4](DECISIONS.md#o4) ids on notices and the
hour window · [O5](DECISIONS.md#o5) the unit's name. None blocks stage 1; O4 gates FIX-2625, and
O1 and O5 gate FIX-2626's spec.

Epic · 12 issues · Framework simplification & cleanup · the objective's kill line (the
composition model changes), with Goal 4 (keep the foundation honest) and Goal 1 (validate
through real usage)
