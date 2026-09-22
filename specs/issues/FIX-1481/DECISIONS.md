# FIX-1481 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

What was considered, what was chosen, why, and what each choice locks in. Two decisions are the
sign-off surface; nothing is open. Everything else here is context for them. The issue covers
ER-Devtool checklist **rows 4, 6 and 5**
([epic rules](../../epics/FIX-1457/BUSINESS-RULES.md#er-devtool)), and uses the epic's numbering
throughout.

## The tree

```mermaid
flowchart TD
  I["FIX-1481 · checklist rows 4, 6 and 5"] --> R4["row 4 · the reason on the row"]
  R4 -.->|"nothing rejected"| X0["the field is already in the browser<br/>a render, decided not asked"]
  I --> D1["D1 · row 6 · mark read-only from the two permission flags<br/>the snapshot carries both"]
  D1 -.->|"rejected"| X1["badge the references folder<br/>wrong for every seat granted read-only"]
  D1 -.->|"rejected"| X2["one resolved boolean on the wire<br/>erases sealed-to-the-model-only"]
  I --> D2["D2 · row 5 · named here, built elsewhere"]
  D2 -.->|"rejected"| X3["a second org-level reader in devtool<br/>two readers for one fact"]
  D2 -.->|"rejected"| X4["declare a client surface on the inventory<br/>opens an org read with no credential"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A document is marked read-only from its `writable` and `llmWritable` flags, which the debug snapshot now carries; the tree resolves them with the expression the resource manifest already uses

| | |
|---|---|
| **Instead of** | Marking anything loaded out of a `references/` folder, or shipping one resolved `readOnly` boolean from the server |
| **Because** | The seal has **two** producers. A `references/` document is sealed by convention; a seat granted `ro` on an ordinary mutable document is sealed the same way, by the same two fields. A folder-derived badge is right about the first and silent about the second, which is the more dangerous half — the reader is looking at something that *is* mutable for somebody else. And the two flags are not one fact: `writable` decides whether code may write, `llmWritable` decides whether the model is offered the write tool. Open to code and closed to the model is a state the framework supports, and one boolean would report it as one of the two things it isn't |
| **Locks in** | Two permission fields on a wire shape every DevTool build then reads, and "read-only" in the tree tied to what the agent's own manifest means by it. A third gate later means finding every reader of the pair. The cheap failure runs the other way: an absent flag means *writable*, and a reader that treats absent as closed marks a document anybody can edit |

**What would change my mind:** evidence that a seat-level `ro` grant is not something anybody
actually writes. Then the seal has one producer, the folder tells you everything, and a badge on
`references/` is strictly cheaper than widening a wire shape.

<a name="d2"></a>
## D2 · Checklist row 5, the org-level inventory, is named in this spec and built elsewhere

| | |
|---|---|
| **Instead of** | Building an org-level inventory reader in the DevTool, or opening the non-debug door by declaring a client surface on the inventory collections |
| **Because** | Three things are missing and only one is DevTool's. **Nothing opens an inventory** — no application calls `openInventory`, so there are no rows for any door to serve. **The non-debug door cannot see them** — the manifest route skips every resource without a `client` config and the inventory collections declare none; adding one opens an org-scoped read on a session whose org is caller-supplied where no principal resolver is configured, the hole [FIX-1475](https://linear.app/fixpoint-labs/issue/FIX-1475) closed on the write side. **The reader is already owned** by [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477) PR-C, whose own plan records it unbuildable until that credential question is answered. A second reader here would duplicate a surface blocked for a reason, not by accident |
| **Locks in** | The checklist carries one unproven row until the credential question is answered and the reader ships. Whoever wants it green owns un-blocking it, and this issue will not have made that cheaper. Rows 4 and 6 are built so neither waits on any of it |

Building it here would also be the substrate growth [ER-25](../../epics/FIX-1457/BUSINESS-RULES.md)
names: a read surface and an authorization model, arriving under the label *polish*. The blocker
is raised up rather than answered locally
([ER-17](../../epics/FIX-1457/BUSINESS-RULES.md#er-17)).

## Decided, not asked

- **Row 4 is a render, and the column's name is the implementer's.** `feedback` is already on the
  DevTool's own mirror of `Task`, so nothing new reaches the browser. The spec pins that the
  reason is legible without expanding the row; whether the header reads `Reason` is a word.
- **The reason shows for whatever status carries it, not only `parked`.** Three verbs write the
  field, and `fail` leaves it on a row that has gone back to `pending`. Hiding it there would
  suppress a true explanation to keep a column's name tidy.
- **The flags are added, not renamed** — the names the framework already uses (BP-034).
- **A server that sends neither flag gets no mark.** Absent is not false (BP-030).
- **The debug gate is untouched.** Making a field visible is not a reason to widen who can see
  the surface.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A `references/` badge in the tree | Simpler, and wrong for every document a seat holds under a read-only grant — the ones a reader most needs to be right about |
| One resolved `readOnly` boolean on the wire | Cheapest wire shape, and it erases open-to-code / closed-to-the-model with no way back to it |
| The reason in the expander, pre-expanded for parked rows | Keeps the row narrow, and keeps the fact one interaction away, which is the bar the collaboration proof sets |
| Declare `client: { state: { read: true } }` on the inventory collections | Opens the non-debug door in one line, and with it an org-scoped read addressed by a caller-supplied org where no resolver is configured. A one-line change that reopens a closed hole is not cheap |
| Build the inventory reader here and let FIX-1477 PR-C adopt it | Two readers for one fact, and this would be the weaker one. The split exists to avoid exactly this |
| Fix `awaitReview` so a park with no reason clears the previous one | A real defect, and a behaviour change to a shipped orchestration API unrelated to the DevTool. Filed as a follow-up ([PLAN.md → Follow-ups](PLAN.md#follow-ups)) |

<a name="the-subject"></a>
## Raised to the epic, not decided here — row 6 has no subject yet

Nothing in the repository declares a sealed document: no team declares one under `references/`,
and no worker holds a read-only grant. So row 6's mark will be proved by automated checks and will
have nothing to appear on when a person looks at the live hire.

This read like a fork — *does this issue add the missing document?* — and the epic has already
answered it. [ER-3](../../epics/FIX-1457/BUSINESS-RULES.md) was rewritten so the proof runs against
whatever live hire the DevForce path stands up, and no longer requires the reference app;
[ER-24](../../epics/FIX-1457/BUSINESS-RULES.md#er-24) forbids reaching into the reference app for
it. So the document comes from the hired tree the proof runs against, and this issue adds none.

What is left is a **dependency on the ER-DevForce producer**: the tree it hires from needs one
sealed document, or row 6 cannot be exercised live however correct the code is. Raised on the epic
per [ER-17](../../epics/FIX-1457/BUSINESS-RULES.md#er-17) rather than answered locally, and carried
in [PLAN.md → At implement time](PLAN.md#at-implement-time) so it is checked before the goal runs.

**Open: none.**

## How it got here

- **Draft** — framed as three checklist rows with three different causes rather than one DevTool
  gap; rows 4 and 6 built as independent deliverables; row 5 named and sequenced out, on evidence
  that its blocker is a credential question rather than an ordering one. The factual base was
  re-derived by running the real handlers before drafting, which is what turned "read-only is
  unrendered" into "the seal has two producers and neither reaches the browser".
