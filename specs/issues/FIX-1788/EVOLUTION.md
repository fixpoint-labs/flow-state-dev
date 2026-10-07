# FIX-1788 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Child-specific lineage. The epic's [EVOLUTION.md](../../epics/FIX-1786/EVOLUTION.md) already
supersedes INST-5 (hires as collection instances with pins) and the hired roster collection;
this record covers the shipped designs FIX-1788 changes in detail.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A hire is durable at once and process-wide only at the next boot, for a fire as much as a hire; one public `register` / `unregister` door; [`../FIX-1475/DECISIONS.md#d1`](../FIX-1475/DECISIONS.md#d1) | **Superseded** | A hire is a row read per turn, so no process registers it; the restart window it documented closes | BR-1, BR-7, BR-20 | The engine's `register` stays for flows; Workforce stops calling it per worker (S14) |
| A stored row that fails at boot is skipped, named and served around; [`../FIX-1475/DECISIONS.md#d2`](../FIX-1475/DECISIONS.md#d2) | **Amended** | Validation moves to save and load: a bad row refuses its own turn, not the boot. The "fail fast on this deploy, degrade on a past one" rule is kept | BR-6, BR-19, BR-22 | `brokenSeats` and `rehire` retire with the boot reload (S14); a refused turn names the cause |
| The durable row is org-scoped, and a hired seat's address carries its org; [`../FIX-1475/DECISIONS.md#d3`](../FIX-1475/DECISIONS.md#d3) | **Superseded** | The row is the owner's, in their per-org user scope; the address is the flow, and the worker is named on the session | ER-1, S3, BR-10 | Old rows are dropped: nothing reads them ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)) |
| A hired seat keeps a person's data in one cell per (org, person), keyed off its owner pin; [`../FIX-1538/DECISIONS.md#d1`](../FIX-1538/DECISIONS.md#d1) | **Superseded** | FIX-1790 keys every flow's user data per (user, org); no worker carries a pin | Epic ER-3, FIX-1790 | Those cells are dropped: nothing reads or moves them ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)) |
| Seat data moves only by an operator step, and only data that provably belonged to a seat; [`../FIX-1538/DECISIONS.md#d2`](../FIX-1538/DECISIONS.md#d2) | **Superseded** by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) (first retained and extended to per-copy cells and sessions, by this issue's D1) | No consumers, so there is nothing to move | — | Old cells and sessions are dropped |
| A worker's `resources:` grant narrows the resource map its copy is minted with, so a block nested in its action resolves only granted documents; FIX-1381, `packages/workforce/src/seat-resources.ts` header and `goals/workforce-seats/a-seat-reaches-the-documents-its-file-names/goal.md` (no retained spec) | **Amended** | A shared copy has one resource map. The grant now narrows what the worker's model reaches on each turn; the flow's own code is the app's | BR-24, S8 | The grants goal is rewritten to grade what the model reaches (V7). The `resources:` key and its `ro`/`rw` words are unchanged |
| Each seat gets its own skills drawer, keyed by its flow-instance id under `flowIsolation`; `packages/workforce/src/agent-worker-flow.ts` (the `collectionConfig` comment) | **Superseded** | On a shared copy the instance id is the flow's, so every worker shares one drawer ([epic POC](../../epics/FIX-1786/poc/singleton-worker-link/README.md), I1, I2) | BR-23, S7 | Each copy's old drawer is dropped ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)) |
| CoS is one org admin seat whose hires belong to the org; [`../../epics/FIX-1650/DECISIONS.md#q2`](../../epics/FIX-1650/DECISIONS.md#q2), already superseded in part by the epic's EVOLUTION | **Superseded in part**, as the epic recorded | Workers are always private: a CoS hire is the hiring user's row | Epic ER-1, S9 | FIX-1719's shipped chief of staff keeps hiring through S9, as the user's, until FIX-1791 replaces it |

None of these is wholly overturned in intent: each kept its permission boundary, and the
boundary moved from a registered copy to a row and a link. Re-check each against current code
before implementing; FIX-1789 and FIX-1790 may have moved two of them first.

Forward lineage: the criteria object of `findWorkerSession` and `ensureWorkerSession` (PLAN S5a)
is extended later by FIX-1794 (`taskId`), FIX-1793 (`workstreamId`) and FIX-1791 (the
coordinator conversation a delegate's session belongs to; FIX-1791 names the key). Each later key
is added to the same lookup path, not to a second helper.

Amended after merge (epic amendment #2831): the lookup matches on the key set, not only on
values (S5a, BR-14a, V4). Without it, a narrower lookup returned a wider session: plain talk
landed in a delegate or task session, and a delegate post in a task session (FIX-1794's spec
review, round 2). The rule lives here once, so FIX-1791, FIX-1793 and FIX-1794 cite it. It is
the session layer of the same isolation the epic's D6 gives the task ledger: D6 keeps one
conversation's rows from another's board, and this keeps one purpose's session from another's
lookup.

<a name="amendment-d9"></a>
## Amended after merge: no upgrade path (epic D9)

**The decision.** On 2026-10-07 the product owner wrote: "No consumers yet. No need for
backwards support of any kind." The epic records it as [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) and
[ER-31](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do). The same day he answered
that the kitchen-sink app's and the DevTeam lab's stores are reset once when this ships. Nobody
outside this repo runs Workforce, so a hire made before this release, its memory and its
conversations are dropped, not moved. The sweep PR removes:

| What | Treatment | Why | What is retained |
|---|---|---|---|
| [D1](DECISIONS.md#d1), old hires moved by one operator step, and [D2](DECISIONS.md#d2), an org-wide hire copied to each member who used it | **Withdrawn**. Both cards are stubs that link the signed text at the commit before the sweep; their figures are deleted | The step protects data no consumer has | D3 and D4, unchanged |
| S13 and P3, the upgrade command and its PR | **Removed**. The plan is three PRs; P4 keeps its name and depends on P2 | Nothing to move | S14 also drops the old roster collections and `HIRED_ROSTER_*`, which only S13 read |
| BR-21, reading an older stored configuration; BR-28 to BR-33a, the step's rules; V10 and leg c, their checks | **Removed**, IDs kept and struck | Follow from D1's withdrawal | The goal's legs a and b and both controls |
| S2, V2 and BR-27, deprecation markers on `register(.., { pin })` and collection cardinality | **Removed** | No consumer to warn before FIX-1798 deletes them | Both stay in the engine untouched until FIX-1798 |
| DOCS, "Upgrading: hired workers become worker rows" on the persistence page | **Removed** | No upgrade page (ER-31) | — |
| SPEC, the goal's last sentence, the upgrade row, leg c and the sign-off's "every old hire" | **Amended** | They described the step | The before-and-after row now says old hires are dropped |

