# FIX-1788 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Child-specific lineage. The epic's [EVOLUTION.md](../../epics/FIX-1786/EVOLUTION.md) already
supersedes INST-5 (hires as collection instances with pins) and the hired roster collection;
this record covers the shipped designs FIX-1788 changes in detail.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A hire is durable at once and process-wide only at the next boot, for a fire as much as a hire; one public `register` / `unregister` door; [`../FIX-1475/DECISIONS.md#d1`](../FIX-1475/DECISIONS.md#d1) | **Superseded** | A hire is a row read per turn, so no process registers it; the restart window it documented closes | BR-1, BR-7, BR-20 | The engine's `register` stays for flows; Workforce stops calling it per worker (S14) |
| A stored row that fails at boot is skipped, named and served around; [`../FIX-1475/DECISIONS.md#d2`](../FIX-1475/DECISIONS.md#d2) | **Amended** | Validation moves to save and load: a bad row refuses its own turn, not the boot. The "fail fast on this deploy, degrade on a past one" rule is kept | BR-6, BR-19, BR-22 | `brokenSeats` and `rehire` retire with the boot reload (S14); a refused turn names the cause |
| The durable row is org-scoped, and a hired seat's address carries its org; [`../FIX-1475/DECISIONS.md#d3`](../FIX-1475/DECISIONS.md#d3) | **Superseded** | The row is the owner's, in their per-org user scope; the address is the flow, and the worker is named on the session | ER-1, S3, BR-10 | Old rows are read once, by the upgrade step ([D1](DECISIONS.md#d1)) |
| A hired seat keeps a person's data in one cell per (org, person), keyed off its owner pin; [`../FIX-1538/DECISIONS.md#d1`](../FIX-1538/DECISIONS.md#d1) | **Superseded** | FIX-1790 keys every flow's user data per (user, org); no worker carries a pin | Epic ER-3, FIX-1790 | FIX-1790's step moves those cells; this step moves only per-copy private cells |
| Seat data moves only by an operator step, and only data that provably belonged to a seat; [`../FIX-1538/DECISIONS.md#d2`](../FIX-1538/DECISIONS.md#d2) | **Retained**, extended | Same rule for per-copy cells and sessions: a copy's own cell and its sessions provably belong to it | [D1](DECISIONS.md#d1), S13 | The step ships as code (that card's *what would change my mind*) |
| A worker's `resources:` grant narrows the resource map its copy is minted with, so a block nested in its action resolves only granted documents; FIX-1381, `packages/workforce/src/seat-resources.ts` header and `goals/workforce-seats/a-seat-reaches-the-documents-its-file-names/goal.md` (no retained spec) | **Amended** | A shared copy has one resource map. The grant now narrows what the worker's model reaches on each turn; the flow's own code is the app's | BR-24, S8 | The grants goal is rewritten to grade what the model reaches (V7). The `resources:` key and its `ro`/`rw` words are unchanged |
| Each seat gets its own skills drawer, keyed by its flow-instance id under `flowIsolation`; `packages/workforce/src/agent-worker-flow.ts` (the `collectionConfig` comment) | **Superseded** | On a shared copy the instance id is the flow's, so every worker shares one drawer ([epic POC](../../epics/FIX-1786/poc/singleton-worker-link/README.md), I1, I2) | BR-23, S7 | The step moves each copy's drawer to its worker's key; nothing is orphaned |
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
