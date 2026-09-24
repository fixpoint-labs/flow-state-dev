# FIX-1546 · Schedule index identity has no storage cell, so two orgs' schedules can collapse onto one row

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Improvement · `core` + `engine` + `scheduled` + `store-sqlite` + `store-postgres` + `bullmq` + `vercel` · small-medium · 1 PR · no epic (a sibling of [FIX-1528](../../epics/FIX-1528/SPEC.md), not its exit proof)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **has a private seat in Acme and one in Globex, each with a schedule named `weekly`** | Both schedules share one row in the schedule index. The row's organization is whichever seat wrote last | Each seat's schedule has its own index row, carrying its own organization |
| **turns off or deletes `weekly` in her Acme seat** | The shared row is removed, so her Globex seat's `weekly` silently stops firing too | Only the Acme row goes. Globex keeps firing |
| **has an app-wide `weekly` and a seat `weekly` in the same org** | They share one index row | Two rows, one per storage cell |
| **upgrades an app that already has schedule rows** | n/a | Existing rows are adopted in place on the next schema init. Nothing to run, nothing stops firing |
| **wrote their own schedule index backend** | n/a | Their code stops compiling at `remove`, and the conformance suite says what to change. No silent misbehaviour |

A hired seat keeps its data in its own storage cell per (org, person) since FIX-1538. The
schedule index, the table the cron tick scans for due schedules, never learned that: it still
files a schedule under just the person and the schedule's name. Two cells, one row.

## What changes

![Two panels, the same three storage cells for Alice, each holding a schedule named weekly. Today all three feed one index row keyed by Alice and weekly whose organization is the last writer. After, each cell feeds its own index row with its own organization](figures/index-identity.svg)

Read the left panel's three lines meeting at one red box: that box is the bug. On the right each
cell has its own row, so no write in one cell can move or remove another's.

**Nothing a flow author writes changes.** `defineScheduleCollection({ pattern, index })` is
untouched. Only an author of a custom index backend sees a change:

```diff
  const myIndex: ScheduleIndex = {
    async upsert(row) {
-     // unique on (row.userId, row.key)
+     // unique on (row.cell, row.key); row.userId is still who the schedule runs as
    },
-   async remove(userId, key) { /* delete where user_id, key */ },
+   async remove({ cell, key }) { /* delete where cell, key */ },
    async claimDue(now, limit) { /* unchanged; rows now carry `cell` */ }
  };
```

## How a row finds its identity

```mermaid
flowchart LR
  R["a run writes schedules/weekly"] -->|"engine already knows the cell"| C["collection hook context"]
  C -->|"cell + key"| H["schedule collection hooks"]
  H -->|"upsert / remove by cell + key"| I["schedule index"]
  I -->|"due rows · person · org"| T["cron tick · unchanged"]
```

The engine already derives the cell for every write. The hook is simply told it, and the index
keys on it. The tick, the dispatch address and the resolver do not change.

## What stays as it is

- **Which flow a tick dispatches to.** The tick still targets one configured flow, and the dispatch
  address is still person + key. Two seat rows for one person and key therefore still dispatch to
  the same address; routing them is out of scope (issue Scope Out) and flagged as a follow-up.
- **The fire path** fixed in FIX-1545, and the org rules FIX-1442 and FIX-1529 set.
- **One schedule store.** No second index, no new store.

## Sign off

1. **[D1](DECISIONS.md#d1) · A schedule's index row is identified by the storage cell the
   schedule lives in plus its name — the same address as the schedule itself.** If wrong: we
   picked organization instead, and a seat and an app-wide schedule with one name in one org
   still collapse.
2. **[D2](DECISIONS.md#d2) · Existing rows are adopted in place as the person's app-wide cell,
   automatically, with no operator step.** If wrong: a seat schedule written by an unreleased
   build between FIX-1538 and this change can fire twice until it is rewritten.

**Open: none.** Number 1 is the one to weigh. Reasoning and what lost: [DECISIONS.md](DECISIONS.md).
The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
