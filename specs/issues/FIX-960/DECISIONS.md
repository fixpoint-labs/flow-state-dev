# FIX-960 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

What was considered, what was chosen, why, and what each choice locks in. Two decisions are the
sign-off surface. Everything else is context for them.

## The tree

```mermaid
flowchart TD
  I["FIX-960"] --> D1["D1 · request state is written by omitting state"]
  D1 -.->|"rejected"| X1["pass ctx.request as the state<br/>also admits session, user and org handles"]
  D1 -.->|"rejected"| X1b["one default slot for both<br/>moves stored tasks"]
  I --> D2["D2 · the board layer keeps its own words"]
  D2 -.->|"rejected"| X2["rename the board layer too<br/>there the two arms really differ"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A request-backed collection is written by leaving `state` out; its default slot stays the `collectionId`

| | |
|---|---|
| **Instead of** | Passing `state: ctx.request` explicitly |
| **Because** | The issue asks for a rename with the same defaults. The two arms default to different slots (`tasks` for a passed ref, the `collectionId` for the request), and stored tasks live at those slots. Keying the request default on an omitted `state` keeps both exactly, with no runtime sniffing of what was passed. Accepting `ctx.request` would type-check `ctx.session`, `ctx.user` and `ctx.org` too, since every scope handle has the same shape, and that is a new storage option nobody asked for |
| **Locks in** | One default a reader must learn: `backing: "state"` with no `state` means the request. Adding an explicit `state: ctx.request` spelling later is additive; removing the omitted form would be a second breaking change |

![Where a request-backed collection's state comes from: omit state, chosen, beside passing ctx.request. Decides it: every stored slot stays where it is with no sniffing. Price: one implicit default. Locks in the omitted form; flips if the request needs to be spelled at the call site.](figures/d1-omit-state.svg)

It comes down to the stored slot: omitting `state` keeps both defaults exactly, while an explicit handle also admits session state.

**What would change my mind:** evidence that readers misread the omitted form as "no state".
Then add `state: ctx.request` as an accepted spelling, restricted to the request handle.

<a name="d2"></a>
## D2 · The task-board layer keeps `"sequencer"` and `"request"`; only the collection factory's options are renamed

| | |
|---|---|
| **Instead of** | Renaming the board's `collection: { backing }`, `TaskBoardBacking` and the board capability options in the same PR |
| **Because** | At the board layer the two arms are genuinely different, so there is nothing to fold: the sequencer spec is scoped to the board's own drain subtree and declares its state schema, while the request spec is reachable from sibling blocks and survives re-draining, and `goalSeekLoop` refuses one and accepts the other. The board layer's `"sequencer"` also names the board's real sequencer, so it does not lie. The issue scopes the rename to the collection factory |
| **Locks in** | Two neighbouring vocabularies: a board says `"sequencer"`, the collection under it says `"state"`. Renaming the board's later is its own breaking change, with its own changeset |

![Whether the board layer is renamed too: keep its words, chosen, beside rename it now. Decides it: the board's arms really differ and its sequencer word is true. Price: two vocabularies side by side. Locks in two words; flips if readers conflate the two layers.](figures/d2-board-words.svg)

It comes down to the board's own arms: they really differ, so a fold there would change behaviour.

## Decided, not asked

- **Hard rename, no alias** — the issue decides it (tenet 3: old and new side by side is how incoherence starts).
- **The removed spelling is rejected loudly:** a type error for typed callers, and a runtime throw
  naming `backing: "state"` for an untyped caller that still sends `"sequencer"` or `"request"`
  (BP-030). Today such a value would fall through to the resource branch and fail obscurely.
- **One `minor` changeset for `@flow-state-dev/orchestration`** (BP-022, pre-1.0): four exported
  names and two option literals change. `@flow-state-dev/patterns` changes internal call sites
  only and gets none. Historical `CHANGELOG.md` entries and archived changesets are not edited.
- **The request adapter stays internal** and keeps its `name: "request"`.
- **Prose that describes a real sequencer's state stays** ("per-turn records land in a
  sequencer's state"); prose that uses "sequencer-backed" as the name of the backing kind is renamed.

## Considered and dropped

| Alternative | Why not |
|---|---|
| One default slot for the folded arm | Moves stored tasks for every caller on the other default: request boards would collide on `tasks`, or checkpointed sequencer boards would look under `collectionId` and find nothing |
| A `state: "request"` sentinel | Explicit, but mixes a string and a ref in one field and still needs a branch on the value |
| Keep `sequencer` as a deprecated alias | The issue rules it out, and an alias keeps the misleading word teachable |
| Only rename the discriminant, keep two arms | Leaves the paragraph explaining why caps sit on two of three arms, which is the issue's second complaint |

## Settled

- **The discriminant is never persisted** (the architect's fence) — **CONFIRMED** on `main`
  `67a3bb9b`. The collection factory reads `backing` only to pick a constructor
  (`get-or-create.ts`, two comparisons); what it writes is `{ [stateKey]: Record<id, Task> }`,
  and the task schema, the `task-change` payload and the devtool carry no backing field. The
  board layer's `backing` lives on the in-memory handle and in error text. **The one persisted
  thing a fold could move is the default slot**, which is why D1 keeps both. No BP-030 dual-read.
- **Call-site count** — the issue's "~22" is exact for `packages/`: 22 collection-factory source
  sites (patterns 14, orchestration 8). The whole tree has 28 source sites (plus kitchen-sink 1,
  examples 4, goals 1), 40 test sites, 2 interface declarations, and 76 code references to the
  direct constructor. The board layer has 32 literals, out of scope. Re-derive with
  `node specs/issues/FIX-960/poc/call-site-census/census.mjs --list`.

## How it got here

- **Draft** — framed as a naming lie over one shared mechanism; fold the two state arms into
  `backing: "state"` keyed on an optional ref so both default slots survive; one PR, collection
  factory only, board layer untouched.

**Open: none.**
