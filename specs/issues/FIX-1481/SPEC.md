# FIX-1481 · Devtool can show an org-level hired Workforce: inventory, parked reasons, and read-only references

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Feature · `devtool` + `engine` + `client` · medium · 2 PRs · epic
[FIX-1457](https://linear.app/fixpoint-labs/issue/FIX-1457) ·
[epic spec](../../epics/FIX-1457/SPEC.md) ·
ER-Devtool checklist [rows 4, 6 and 5](../../epics/FIX-1457/BUSINESS-RULES.md#er-devtool)

## Four people, before and after

| Someone who… | Today | After |
|---|---|---|
| **runs the release checklist and finds a row parked** | Sees a `parked` pill and no reason. The raw JSON expander on that one row is the only way to read why | Reads the reason on the row. The handoff is observable without touching raw state |
| **asks which documents a hired agent can write** | Cannot. A sealed document and a writable one are the same row, field for field | Sees which are read-only, marked from the same two permissions that decide whether the agent is offered a write tool at all |
| **wants to trust an agent not to edit the handbook** | Reads the team's files on disk and reasons about it | Reads it off the screen in front of them |
| **wants the org's inventory without a debug flag** | Behind `FSDEV_DEBUG_ENDPOINTS=1`, and the reference app writes no inventory rows, so there is nothing behind the flag either | Unchanged, and **named**: three things are missing, not one, and who owns each is written down ([D2](DECISIONS.md#d2)) |

The checklist exists so somebody other than its author can confirm a hired Workforce is real. Two
rows fail on the same defect — the fact is already in the browser and nothing renders it. The
third fails for a different reason, and calling all three "a DevTool gap" is what has kept it
moving between issues.

## What changes

![Three checklist rows, today beside after. A parked task row gains a Reason column so the reason no longer hides inside a JSON expander. Two identical resource-tree rows gain a read-only mark on the sealed one. The org-level inventory row stays on the far side of a dashed fence, unbuilt here](figures/what-changes.svg)

Read down the lanes; they are the epic's checklist rows, grouped built-then-not rather than in
numeric order. Rows 4 and 6 change; row 5 is on the far side of the fence and stays there
([D2](DECISIONS.md#d2)). The mark in the middle lane comes from the document's two permissions,
not from the folder it was loaded out of — [D1](DECISIONS.md#d1), and it matters because the seal
has two producers.

**What a snapshot of one document carries, as the browser receives it:**

```diff
  { "primaryName": "handbook", "scope": "org", "isCollection": false,
+   "writable": false, "llmWritable": false,
    "clientConfig": { "hasClient": false, "data": false, … } }
```

Two fields, not one verdict. They answer different questions — whether code may write, and whether
the model is offered a write tool — and collapsing them loses a state that really occurs. The tree
renders one mark from them through a single exported `mayWrite` helper, which is also what the
agent's own resource manifest calls to decide the same thing. One definition, two readers.

## What stays as it is

- **The per-row JSON expander and the tree's scope badge.** Both keep working; this adds beside
  them and removes nothing.
- **The debug endpoint and its gate.** `FSDEV_DEBUG_ENDPOINTS=1` still guards the surface, still
  fails closed, still refuses an off-host origin.
- **The instance list, session switching and request inspection.** Already shipped
  ([FIX-1324](https://linear.app/fixpoint-labs/issue/FIX-1324), re-homed into `FlowNavigator` by
  [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477) PR-B). Not rebuilt, and not pending.
- **The `references/` versus `resources/` split.** Settled by
  [FIX-1467](https://linear.app/fixpoint-labs/issue/FIX-1467). This makes the shipped distinction
  visible and reopens none of it.
- **What a task row means.** No new status value, no second hold enum, no "parked reason" type,
  and no *Waiting on you* column. The field surfaced is the one `awaitReview` already writes, and
  *Waiting on you* stays a reading over parked-plus-reason
  ([ER-2](../../epics/FIX-1457/BUSINESS-RULES.md), [ER-8](../../epics/FIX-1457/BUSINESS-RULES.md)).

## What we still have not seen

Nobody has run the DevTool against a live hired Workforce. Everything above was re-derived by
running the real modules and handlers ([the POC](poc/what-the-tree-can-say/README.md)) — stronger
than a source read, still not a browser against a running hire. Two things stay open because of
it, neither in scope: whether a seat **reads as a seat**, with its kind and team, rather than a
bare flow id; and whether channel membership has any view, which in source it does not. **The
three rows are a confirmed floor, not a ceiling.** A live look may add rows, by name, not by
widening this one.

## Sign off

1. **[D1](DECISIONS.md#d1) · A document is marked read-only from its two permission flags, which
   the snapshot now carries, resolved by one shared `mayWrite` helper — not from the folder it
   came from.** If wrong: we have put two permission fields on a wire shape that every DevTool
   version then has to keep reading, and a reader that mistakes an absent flag for a closed door
   will call a writable document sealed.
2. **[D2](DECISIONS.md#d2) · The org-level inventory row is named here and built elsewhere.** If
   wrong: the checklist carries an amber row for however long the org-level reader takes, and the
   release proof is incomplete in a way a reader may read as "it does not work".

**Open: none.** One question looked like a fork and was not: nothing in the reference app declares
a sealed document, so row 6 has nothing to appear on — but
[ER-3](../../epics/FIX-1457/BUSINESS-RULES.md) already says the proof runs against whatever live
hire stands the workforce up, and [ER-24](../../epics/FIX-1457/BUSINESS-RULES.md#er-24) says not
to reach into the reference app for it. That is answered, and it is raised to the epic as a
dependency rather than decided here ([ER-17](../../epics/FIX-1457/BUSINESS-RULES.md#er-17)).
Number 2 is the one to weigh — it is the row that has already moved between issues twice. The
reasoning and what lost: [DECISIONS.md](DECISIONS.md). The cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md).
