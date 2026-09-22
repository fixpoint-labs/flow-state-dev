# FIX-1481 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. A human reviews this page; the plan turns it into
work. Row numbers are the epic's ER-Devtool checklist
([rows 4, 6 and 5](../../epics/FIX-1457/BUSINESS-RULES.md#er-devtool)).

## The reason on a task row · checklist row 4

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A task is parked with a reason | The reason is legible on the row itself, with no expander opened | CI · rendering check |
| BR-2 | A task is parked and no reason was given | The row shows an explicit nothing, not an empty cell that reads as "no reason exists" | CI |
| BR-3 | A task is parked with no reason **after** an earlier attempt wrote one | The earlier text is still on the row, because the park did not clear it. Known and named: the field is rendered as the row carries it, and the clearing is an orchestration defect filed as a follow-up, not papered over in the view | CI · asserted as the current behaviour so the fix flips this row |
| BR-4 | **Any** task carries `feedback`, whatever its status — including one that failed, retried, and is back at `pending` | It is shown. The predicate is the presence of the field, with status out of it entirely: the column is what the row currently says about itself, not a parked-only field | CI · asserted on a board whose only row is `pending` with feedback |
| BR-5 | A task was unparked with a new reason | The new text replaces the old, because the unpark wrote it | CI |
| BR-6 | A reason is long, or contains markup, or is one unbroken token | It is still readable on the row, the table still looks like a table, and the full text is still in the expander. How that is achieved is the implementer's | CI · plus the VG sentence, which is the real bar |
| BR-7 | Any task row is opened in the JSON expander | Unchanged, byte for byte. The expander is still the complete view | CI |
| BR-8 | **No row on the board carries `feedback`** — whatever their statuses, parked or not | The board renders as it does today. No empty column apologising for itself | CI |

**Both BR-4 and BR-8 are keyed on the presence of `feedback`, never on `parked`.** That is the
whole of it, and keying either on status breaks the other: a board holding one retried `pending`
row that carries feedback has no parked rows *and* has something to show, so a parked-keyed
column would have to suppress BR-4 to satisfy BR-8 and no implementation could pass both.
`feedback` is written by three verbs — the park, the retry and the unpark — so it was never a
parked-only field. Waiting-on-you is unaffected: it stays a reading over parked *plus* reason and
never a status value or a column of its own (BR-18).

## The read-only mark in the resources tree · checklist row 6

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | A document declares `writable: false`, whatever `llmWritable` says | Marked read-only, visibly distinct from a writable neighbour at a glance. This one field is the mark's whole predicate — it is the condition the engine itself refuses a write on (`resource-registry.ts:936`, `:1977`) | CI · goal check |
| BR-10 | A document came from a `references/` folder | Marked read-only — because of its flags, not its folder | CI |
| BR-11 | A seat holds a read-only grant on an ordinary mutable document | Marked read-only. Same mark, same reason, different producer | CI |
| BR-12 | A document declares neither flag | **Not** marked. Absent means writable, which is the framework's default | CI · the flag left out entirely, not set to `true` |
| BR-13 | A document is writable by code but closed to the model (`llmWritable: false`, `writable` unset) | Not marked read-only — it is not read-only. `llmWritable` is opt-in, so this is the ordinary state of most of the tree, and marking it would make the badge meaningless. Both flags are in the row's detail for a reader who needs the distinction | CI |
| BR-14 | A collection is sealed | The mark sits on the collection, whose config carries the flags. Its items are not marked one by one | CI |
| BR-15 | The DevTool is pointed at a server that predates this change and sends neither flag | No mark anywhere, and no error. Absent is absent, not false | CI · the second path (BP-035), run against a snapshot with the fields removed |
| BR-16 | The tree renders any document at all | The scope badge it shows today is unchanged and still present | CI |
| BR-17 | A reader asks what the mark means | **This handle refuses state and content writes** — from code and from the model alike. It does **not** mean "the agent is not offered a write tool"; that is a different question with a different answer, and the row detail carries it. Nor is it a claim about the underlying data: a shared `org` or `user` cell can still be written through another flow that declares it writable, and on a collection the mark leaves `create`, `getOrCreate` and `delete` open ([FIX-1510](https://linear.app/fixpoint-labs/issue/FIX-1510)) | CI · the mark asserted on `writable` alone, and asserted **absent** on a document that is merely not offered to the model |

![Four documents arrive at one resolving expression: a references document and a seat's read-only grant, both carrying writable false and llmWritable false, and two carrying no flags at all. A dashed horizontal line on the far side separates marked from unmarked; the two sealed documents come out above it, the two with no flags below](figures/one-gate.svg)

Four arrivals, one gate, and a line on the right that is the whole rule set: above it is marked,
below it is not. The gate reads `writable` and nothing else. The two on its left are the two ways
a document becomes sealed, and they come out as one mark; the two below the line are BR-12 and
BR-15. The mermaid is the same four paths by name.

```mermaid
flowchart LR
  A["a references document"] -->|"writable false"| G["the tree's sealed gate · writable === false"]
  B["a seat's read-only grant"] -->|"writable false"| G
  C["no flags declared"] -.->|"absent means writable · BR-12"| G
  D["a server that predates this"] -.->|"nothing on the wire · BR-15"| G
  G --> M["marked, or not"]
```

> **Correction · 2026-09-22 · BR-17's gloss only.** BR-17 used to answer *what the mark means*
> with **"immutable to everyone — the store refuses the write."** That overstates it in two
> directions. `writable: false` closes the state-write and content-write doors **on the handle that declares it**, not on the
> storage cell: a seat's read-only copy is a shallow copy of the declared entry
> (`packages/workforce/src/seat-resources.ts` → `readOnly`), so the same `org` or `user` cell
> remains writable through a flow that declares it writable. And on a **collection** the flag
> gates two functions — `persistNamespaceInstanceState` and the instance `writeContent` — and
> therefore every operation that routes through them, `upsert` on an existing key included. What it
> does **not** gate is the lifecycle: `create` (including `{ replace: true }`), `getOrCreate` and
> `delete` never consult it (`packages/engine/src/context/resource-registry.ts`), which is
> [FIX-1510](https://linear.app/fixpoint-labs/issue/FIX-1510).
>
> **The predicate and every other rule are unchanged.** BR-10 … BR-16 stand as written, the
> mark is still `writable === false` and nothing else, and no CI proof moves. Only the sentence a
> reader is handed when they ask what it *promises* was too wide.
>
> The implementation PR [#2039](https://github.com/fixpoint-labs/flow-state-dev/pull/2039) carries
> the narrower wording in the tooltip and in `debug-vs-client-state.md`. **It is open as of this
> writing**, so the published page does not say this yet.

## What neither row may do

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | Either row ships | `TaskStatus` has gained no value, and no *Waiting on you* status or column exists. *Waiting on you* stays a reading over parked-plus-reason ([ER-2](../../epics/FIX-1457/BUSINESS-RULES.md), [ER-8](../../epics/FIX-1457/BUSINESS-RULES.md)) | CI · asserted on the exported status union, so a later widening fails here |
| BR-19 | Either row ships | The debug surface's gate, origin allow-list and fail-closed default are unchanged, and no resource gained a `client` config to widen who can read it | CI · the existing debug-gate suite, unmodified |

## Failure taxonomy

Nothing is fatal and nothing retries. A missing reason degrades to an explicit nothing (BR-2);
missing flags degrade to no mark (BR-12, BR-15). The only outcome worse than silence is a wrong
mark, which is why absent is never read as closed and why the mark has exactly one meaning
(BR-17) rather than approximating a neighbouring one.

## Acceptance criteria this issue owns

Against a DevTool showing a board with a parked row and a tree holding one sealed and one writable
document: a person who has not read this spec can say why the row is parked and which document an
agent may write, with no expander opened and no debug flag set beyond what `fsdev dev` already
sets. That is the goal check the plan runs last.

**Not owned here.** The org-level inventory row ([D2](DECISIONS.md#d2)) has no acceptance
criterion, deliberately. Nor does whether a seat reads as a seat, or whether channel membership
has a view — both unverified, both named in [SPEC.md](SPEC.md) → "What we still have not seen".
