# runtime

The tick, and the durable state it runs against. Everything else in this package is
a piece; this is what puts the pieces in an order and gives the result somewhere to
live.

```
openConductor({ config, statePath })
      │
      ├─ manage(item)  registry row, entity row, the work item's own prose
      ├─ tick(id)      observe → decide → execute → ledger
      └─ read(id)      the same answer, reducing nothing
```

| File | What it owns |
|---|---|
| `session.ts` | `openConductor` — manage, tick, read, and where a work item's session comes from |
| `tick.ts` | one tick: read the world, reduce each signal, execute the actions, append the ledger |
| `collections.ts` | the collections of `../model/entities.ts`, resolved to the address their declared scope names |
| `store.ts` | records under `statePath`, addressed `(scope, scopeId, key)` |

## The three properties

They are not checks. Each is a consequence of an ordering decision, which is the only
way a property survives a change nobody remembers to re-verify.

- **A redundant tick costs nothing.** Signals do not come from a queue conductor
  drains — they come from `reconcile` diffing the world against the copy the previous
  tick persisted. An unchanged world diffs to nothing, and a ledger row is appended
  only when a signal produced an action. Zero rows, zero dispatches.
- **A restart resumes; it does not redo.** The gate cannot be lost, because it is
  never stored. The dispatch is the part that can be repeated, and two orderings stop
  it: **the ledger row is written before the action it records takes effect**, and
  **the phase moves after its row, with the ledger winning if the two disagree**
  (`loadEntity` adopts the ledger's phase, because the ledger is the authority for a
  transition and the entity row is a projection of it). The entry a phase move
  queues is covered by the same authority: **a phase's entry work runs once, and
  runs at least once**, because it is re-derived until a ledger row shows a
  `phase_entered` reduced against *that* phase. Resuming into a phase whose entry
  never ran is what a nonempty-ledger test misses, and it is unrecoverable — an
  artifact-free world produces no signal that could start the work later.
- **This holds for one tick at a time, per entity.** A tick is a read-modify-write
  and none of it is atomic; two overlapping ones read the same cursor and ledger
  sequence and run the same paid dispatch twice, with the atomic rename hiding it.
  `session.ts` queues ticks per entity **within a process**, and says there what
  that leaves unprotected — two processes over one `statePath` still race, so one
  process per `statePath` is a deployment requirement.
- **Every transition is reproducible from the ledger.** A row carries `decide`'s three
  arguments whole, so re-running it from the row alone produces that row's action
  again. Anything the tick does that `decide` did not produce therefore has no place
  in the ledger — which is why a divergence is adopted rather than recorded.

## What the tick does not do

- **It never merges**, and there is no operation here that could.
- **It calls no model.** Observe, reduce, execute, append — every judgment arrived as
  a signal before it was acted on. A model anywhere in this loop would produce a
  different transition from identical state, which is the failure the ledger exists to
  make impossible.
- **It does not persist the cursor before reducing.** Doing so would lose a signal
  permanently on a crash mid-tick and strand the entity at a gate nothing releases.
  Persisting it after means a crash mid-tick re-observes what it had already reduced,
  and may repeat a dispatch that was in flight. That trade is chosen deliberately;
  see `tick.ts`'s header.

## Where a work item lives

`manage` mints one session id per item and writes it to the org-scoped registry. Every
later call reads that row to find out where the item's state is — **session identity is
written once and read back, never derived**, matching `SessionRecord.lineageId`. An id
computed from the issue key is one two processes can compute their way to different
answers about.

M1 manages **top-level work**: an epic, or an issue running without one. Such an item's
own session is its lineage root, so the two session altitudes resolve to the same
address — the case `../model/entities.ts` calls out as needing no special handling. An
issue running *under* an epic needs a workstream session whose lineage is the epic's;
`collections.ts` resolves that address correctly, and nothing mints it yet, because the
registry holds one session id per row and has nowhere to record the second.

## The store

One file per key, keys' segments are directories:

```
<statePath>/org/<orgId>/registry/FIX-1.json
<statePath>/session/<sessionId>/ledger/FIX-1/3.json
<statePath>/session/<sessionId>/issues/FIX-1.json + .md   ← state, and its prose
```

A ledger append is therefore one atomic file write rather than a read-modify-write of a
growing document, which is what makes "the row is on disk before the dispatch runs"
cheap enough to do on every action. It also leaves the directory readable by a human
debugging a stuck entity.
