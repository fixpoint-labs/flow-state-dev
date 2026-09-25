# FIX-1583 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Decided input, not re-argued here: the owner's reversal of FIX-1557's D1 on
[#2234](https://github.com/fixpoint-labs/flow-state-dev/pull/2234#issuecomment-5831771033) (a
provided utility, peer of `cascadingRouter`, not a new block kind and not a change to
`evaluator`); FIX-1557's [D2](../FIX-1557/DECISIONS.md#d2) and [D3](../FIX-1557/DECISIONS.md#d3),
which this utility carries over unchanged; and the epic's
[D3](../../epics/FIX-1553/DECISIONS.md#d3) with ER-3, ER-9 and ER-11 (the app owns its questions
and its model; nothing retries; confidence gates only where asked). The three cards are what that
leaves open: where it lives and how it breaks the cycle, what happens to the recipe, and one
refusal.

## The tree

```mermaid
flowchart TD
  I["FIX-1583"] --> D1["D1 · a core definer that owns the collection"]
  D1 -.->|"rejected · widens a core contract for one caller"| X1["lazy reactTo in core"]
  D1 -.->|"rejected · a contract with no host"| X1b["a new facets package"]
  D1 -.->|"rejected · the cycle lands on the app"| X1c["a reaction-only helper"]
  D1 -.->|"rejected · breaks the one-block contract"| X1d["core's utility namespace"]
  I --> D2["D2 · example and docs move onto it"]
  D2 -.->|"rejected · two ways to do one thing"| X2["keep teaching the copy"]
  I --> D3["D3 · client body edits refused"]
  D3 -.->|"rejected · stale facets with no error"| X3["allow them, document reindex"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A core definer, `defineFacetedCollection`, beside `defineResourceCollection`, that owns the collection definition. No lazy `reactTo`, no new package

| | |
|---|---|
| **Instead of** | (a) A lazy `reactTo` in core (`reactTo: () => ({ … })`) plus a reaction-only helper the app wires into its own collection · (b) a reaction-only helper with no core change, leaving the app to break the cycle · (c) core's `utility` namespace beside `cascadingRouter`, revising `docs/architecture/utility-blocks.md` to allow a non-block result · (d) a new `@flow-state-dev/facets` package · (e) `@flow-state-dev/tools` or `@flow-state-dev/memory` |
| **Because** | **Why a factory:** it gives apps one taught path with the facet fields merged into their schema, refuses the miswirings at build (BR-3 to BR-6, BR-26 to BR-28, [D3](#d3)), and hides the definition order from them. A reaction-only export would work at runtime, as the recipe does, but would give up all three. **The cycle is about declaration order, not about runtime.** A reaction block reads the collection through `ctx.resources`, and that map is the flow's registry keyed by accessor, whatever the block declares (`createExecutionContext`'s flat registry). The recipe already works by reading it undeclared. A lazy `reactTo` would let the block *declare* the collection, which buys a type and changes nothing at runtime, and would still leave the accessor name to agree on. It would also move `validateReactTo`'s refusal from definition time to first dispatch for every resource definer. Tenet 5: fix it at the layer that owns it, and the only caller that meets the cycle is the one that defines both halves. A factory that defines the collection builds the reaction first, then the collection, then the blocks that declare it, so the app never sees the ordering. **Placement:** the result is a collection plus blocks, and `docs/architecture/utility-blocks.md` defines every `utility.*` as returning one `BlockDefinition` whose `name` is the block's name. Putting it in `utility` would give that namespace two meanings, and revising the contract for one caller is the kind of widening this decision is avoiding. It is a definer, so it sits where apps already define collections: exported from core's root next to `defineResourceCollection` and `defineProjectedResourceCollection`. It stays the owner's named peer of `cascadingRouter` in role (a provided building block, not a block kind), not in namespace. Everything the factory uses ships in core, and core is isomorphic, so the token uses `crypto.randomUUID()` as core's edge helpers do. A new package is tenet 3's contract without a host. `tools` holds tool blocks, and a reaction isn't one. `memory` is a different domain. None of these adds a dependency, which is ER-11's fence for consumer packages |
| **Locks in** | One export, `defineFacetedCollection`, returning `{ collection, search, reindex, resources }`. The app picks the accessor (`name`) and registers `resources` on the flow; its blocks read and declare the collection under that name. `resources` also carries the evaluator's own declared resources, so the reaction's evaluator has what it declared however the flow is wired ([Settled](#open--settled)). What the factory can't express stays on hand-wiring: projected collections (they have their own `filter` query), parameterized key patterns such as `[topic]/observations` (a content change carries their full path, which a string key can't address; refusing them can be lifted later without breaking anyone), a second `contentUpdated` reaction on the same collection, questions computed per call, and an evaluator whose declarations can't be carried to the flow. Each is refused by name at build ([BUSINESS-RULES](BUSINESS-RULES.md#building)) |

**What would change my mind:** a second consumer that needs a collection and its reaction to
refer to each other, from outside core. Then the lazy form earns its contract.

<a name="d2"></a>
## D2 · The example and the docs move onto the utility. The hand-wired reaction stops being taught as code to copy. Stored field names don't change

| | |
|---|---|
| **Instead of** | Keeping the recipe as the documented path, with the utility beside it as an option · or renaming the stored fields to something the utility owns |
| **Because** | Two taught ways to write the same three rules drift, and the copy is the one that drifts: the recipe's own first version let stale answers back in, and only a review caught it (#2210). The runnable example is also leg (e)'s proof: pointing it at the utility makes the goal prove what ships, not a copy of it. Keeping `facets` and `indexedAs` means an app that copied the recipe swaps one definition and keeps every stored facet (BP-030): no migration, no reindex |
| **Locks in** | `examples/guides/index-time-facets/` uses the utility, and its copied reaction, search and matcher are deleted. The searching page teaches the utility; the three rules become a short "what it does for you" list, and the hand-wired form survives as one link to the utility's source for shapes the factory refuses. The Linear lock "don't replace FIX-1557's recipe PR" holds: that PR merged, and this one moves the example forward rather than rewriting its history |

**What would change my mind:** an app that needs a shape D1 refuses, asking for the walkthrough
back. Then the hand-wired form returns as a docs section, not as the default.

<a name="d3"></a>
## D3 · A faceted collection refuses client-side body edits when it is defined

| | |
|---|---|
| **Instead of** | Allowing `client.content.create` and `client.content.update` and documenting "reindex after client edits", as the recipe's docs do today |
| **Because** | A client body edit runs outside any flow turn, so no reaction fires ([reactive blocks docs](../../../apps/docs/docs/resources/reactive-blocks.md)). The document keeps answers about text it no longer has, and a facet search returns it: the one wrong result a deterministic search can't detect, and the failure FIX-1557's D2 exists to prevent. The recipe could only ask; a utility can refuse. Projected collections already refuse the same grants at build time, so the error has a precedent. Client *reads* and deletes stay allowed |
| **Locks in** | An app with a browser editor writes the body through a flow action instead, which indexes. The refusal lifts, additively, when client edits fire reactions |

**What would change my mind:** client edits running reactions. Then this refusal is removed, not
kept as policy.

## Decided, not asked

- **The evaluator's own questions are the facets.** The app passes only the evaluator block; the
  utility reads its static question set, types the stored facets and the search options from
  it, and refuses an evaluator whose questions are computed per call. Passing the questions a
  second time was dropped: a mismatch would surface only as failed stores. The evaluator receives
  the body as its input (epic D3, ER-11).
- **Search filters choice questions.** Boolean and score answers are stored and readable on each
  row; the search offers no option for them in v1. A floor on them would be a number the utility
  chose (ER-3).
- **`minConfidence` applies to the values the query names**, and an answer without confidence
  fails it (FIX-1557 BR-10, ER-4's rule at a gate). A query naming no values matches every
  classified row, as the recipe does.
- **Search lists and filters in memory.** Store-backed collections have no query filter today
  (`list(prefix)` only); a source-side filter is a follow-up (BP-033).
- **A wrong accessor fails loudly.** If the collection isn't registered under `name`, the first
  body write fails with an error naming `resources`. That is a wiring bug, not a model failure,
  so it doesn't get D2's quiet path.
- **Registration goes through `defineFlow({ resources })`**, so a search offered only as an agent
  tool still works whether or not
  [FIX-1578](https://linear.app/fixpoint-labs/issue/FIX-1578) ([#2241](https://github.com/fixpoint-labs/flow-state-dev/pull/2241))
  has merged.
- **Changeset: `patch` on `@flow-state-dev/core`.** The export is additive, and pre-1.0 additive API is `patch` (AGENTS.md → Changesets, BP-022).

## Considered and dropped

| Alternative | Why not |
|---|---|
| A capability (`uses: [facets]`) | A capability contributes resources, tools and context to a block; it can't own a collection's `reactTo`, which is the whole job |
| A lazy `resources` thunk on blocks | Same as the lazy `reactTo`: it fixes a declaration the runtime doesn't read |
| Auto-reindex when the questions change | The owner's flagged follow-up on #2234. Not here |
| A facet filter on FIX-1482's work-query tool | Owned there |

## Open / Settled

**Open: none.**

**Settled.**

- **Reaction blocks see the flow's whole resource registry, not only what they declare.**
  CONFIRMED from `main`: `ctx.resources` is one flat registry keyed by accessor
  (`packages/engine/src/context/createExecutionContext.ts`), and the dispatcher runs the bound
  block with that context (`reactive-dispatch.ts`). The recipe's reaction reads
  `ctx.resources.tickets` undeclared, and its 20 tests pass on `main` at `287e7c28e` (13 in `facets.test.ts`, including the V5 and V9 races).
- **Reactive blocks' own declarations don't register anything.** CONFIRMED: `defineFlow` collects
  resources from action blocks and the flow's `resources` map (`collectBlockResources`,
  `mergeFlowResourceMap`); nothing walks `reactTo`.
- **A parameterized collection can't be addressed from a content change.** CONFIRMED from
  `main`: for a pattern with no leading prefix, the dispatcher's `key` is the full storage path
  (`reactive-dispatch.ts`, `resolveConfigFor`), and `resolveCollectionKey()` throws on a string
  key for a parameterized pattern (`packages/core/src/types/collection-patterns.ts`). Hence
  BR-26: refused at build rather than failing on the first write.
- **The evaluator's own declarations are lost unless carried.** CONFIRMED from `main`: `defineFlow`
  collects resources from action roots and the flow's `resources` only, and flow-config
  requirements from blocks reachable from action roots (`collectBlockResources`,
  `collectRequiredFlowConfig`); neither walks `reactTo`. So the definer carries the evaluator's
  declared resources (its own and its static capabilities') into the returned `resources`
  (BR-27), and refuses what can't be carried: a `flowConfigSchema`, and a lazy single resource,
  which `defineFlow` rejects at flow level (BR-28).
- **The evaluator block keeps its config.** CONFIRMED: `buildBlock` carries the config onto the
  definition, so core can read static questions without a public field.

## How it got here

- **Draft** — framed as the recipe's three rules living in every app's copy; a core utility that
  owns the collection, so the definition-order cycle stays inside it and core's `reactTo` doesn't
  change; the example, docs and leg (e) move onto it with the stored fields unchanged; one PR.
- **Review round 1** — Codex found three things the draft missed, each checked against `main`.
  `utility.*` is contracted to return one block, so the factory became a root definer,
  `defineFacetedCollection`, beside `defineResourceCollection`. Parameterized key patterns can't
  be addressed from a content change, so they are refused at build (BR-26). The flow never sees
  the evaluator's own declarations, so `resources` carries them and the definer refuses the ones
  it can't carry (BR-27, BR-28). The changeset is `patch`.
