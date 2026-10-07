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
is added to the same lookup path, not to a second helper. Since the binding amendment
([below](#amendment-binding)), each later key is a readonly field of the worker flow's session
state, because the listing filters on readonly fields only.

Amended after merge (epic amendment #2831): the lookup matches on the key set, not only on
values (S5a, BR-14a, V4). Without it, a narrower lookup returned a wider session: plain talk
landed in a delegate or task session, and a delegate post in a task session (FIX-1794's spec
review, round 2). The rule lives here once, so FIX-1791, FIX-1793 and FIX-1794 cite it. It is
the session layer of the same isolation the epic's D6 gives the task ledger: D6 keeps one
conversation's rows from another's board, and this keeps one purpose's session from another's
lookup.

Amended after merge (FIX-1802's spec PR #2839): the criteria key FIX-1791 names is `filingSessionId`
(renamed from `coordinatorSessionId`; never shipped). V4 and the follow-up note read the new name.

<a name="amendment-d9"></a>
## Amended after merge: no upgrade path (epic D9)

**The decision.** On 2026-10-07 the product owner wrote: "No consumers yet. No need for
backwards support of any kind." The epic records it as [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) and
[ER-31](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do), with the store reset that goes with it. Nobody
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

<a name="amendment-cross-spec"></a>
## Amended after merge (cross-spec alignment, 2026-10-07)

**The alignment.** Reading the epic's merged child specs against each other found places where
siblings read two ways. Each was an engineering call, made under decisions already taken, and
recorded in the epic's [How it got here](../../epics/FIX-1786/DECISIONS.md#how-it-got-here). This
spec changed:

| What | Treatment | Why | What is retained |
|---|---|---|---|
| BR-8 and S9: a turn names the collections it wrote | **Amended**: the view reloads after the turn, and no tool name is treated specially | FIX-1761 left no durable record of what a request wrote (`503c9790e`); epic ER-19 now says so | BR-8's ID |
| S7: the skills library takes its key per run | **Amended**: a function the composing layer supplies, naming no worker; counted as epic D3's sixth mechanism change | Orchestration is Layer 1 (epic D6, D7), so the change needed the epic's count | S7's scope; the stop rule if it needs `core` or `engine` |
| The guardrail "no Layer 1 change beyond S1" | **Amended**: S1 and S7's per-run key, with orchestration named as Layer 1 | Follows from S7 | — |
| BR-22a's BP-030 citation | **Amended**: the rule gives its own reason | Epic D9: BP-030 doesn't apply to this epic | The rule: the row is untouched |
| DOCS, "After a hire, refresh the roster" | **Amended** | Follows from BR-8 | — |

<a name="amendment-binding"></a>
## Amended after merge: binding through readonly state, and privacy on a custom worker flow (2026-10-07)

**The problem.** This spec said a session's worker sat in a server-only field on the session
record, beside its state, set from a `worker` option on `createSession` and filtered by one on
`listSessions`. P1 ([#2850](https://github.com/fixpoint-labs/flow-state-dev/pull/2850)) built a
different mechanism instead: the worker is a readonly field of the session's starting state,
checked at create. The product owner approved that on 2026-10-07 and rejected a separate link
concept. The same day, the product owner answered Q6, raised on P2
([#2856](https://github.com/fixpoint-labs/flow-state-dev/pull/2856)), as A: on a custom worker
flow, keeping one user's workers apart is the flow's author's job. The spec still described the
link and promised per-worker privacy on every worker flow. Original review:
[#2812](https://github.com/fixpoint-labs/flow-state-dev/pull/2812), amended by
[#2818](https://github.com/fixpoint-labs/flow-state-dev/pull/2818).

| What | Treatment | Why | What is retained |
|---|---|---|---|
| [D4](DECISIONS.md#d4)'s mechanism: a server-only field on the session record, a `worker` option on create and list, and a create check that returned the value the engine stored | **Superseded** by [D5](DECISIONS.md#d5) | The product owner rejected a separate link. A readonly field, the optional create check and the store-level filter answer each reason D4 gave for keeping the worker out of state: writable, set unchecked by the caller, not listable | D4's call, named once at create; its card as signed is linked from it, and its figure is renamed `d4-named-at-create.svg` |
| *Considered and dropped*: the worker in plain session state (O1) | **Kept as dropped, reasoning answered** | "Checked on read" is still wrong. Checked at create and readonly after is D5 | The R1 row: state is deleted with its record, so nothing outlives a deleted session |
| S1: a create field outside `state`, `useFlow` passing `worker`, `fsdev run --worker` | **Amended** to what P1 shipped | Readonly fields, an optional `createCheck`, `serverOwned`, a listing filter on readonly fields, a schema refusal on flows that bind their sessions, and a dispatcher's child `state`. `fsdev run` takes the worker through `--seed-session`; `useFlow` is unchanged | The one birth function on all five paths, the lost-race behaviour, `serverOwned` for FIX-1791 |
| The schema refusal at create | **Narrowed**, an engineering call | Refusing on every flow would break the mailbox and the project rooms, which create half-filled sessions on purpose | Follow-up: widen it to every flow once FIX-1792 removes the mailbox |
| BR-15: caller state for "the link or a server-written field" | **Narrowed** to server-written fields | Naming the worker in the create's state is how a session is created (BR-10) | The 400 naming the field |
| BR-23, S7 and V6: "every flow-isolated resource on every worker flow", "and on one app flow" | **Narrowed** by [D6](DECISIONS.md#d6) | The risk stays inside one user; B repeats FIX-1789's introspection holes; C is an engine change beyond the epic's six | BR-23 on the built-in worker flows, the skills library's per-run key and `agent`'s drawer (S7). New: BR-23a and a DOCS.md section showing an author how to key data by worker |
| The goal's `GOAL_CONTROL=caller-link` | **Replaced** by `no-create-check` | The old control read the worker from the create's state instead of a server-only field, and that field no longer exists. Removing the create check is what now lets Bob's create name Alice's worker | `org-scoped-workers`, unchanged. FIX-1797's PLAN (P3.3) still names `caller-link` |
| Pinned names: `worker` on `createSession` and `listSessions`; `workerId` in a generic create field | **Removed** | No link | `workerId`, now a readonly session-state field; `createWorkforceClient` keeps `worker` as its criteria key |
| DOCS: the `flow.md` session rows and the "Creating sessions" paragraph, both with a `link` input; `useFlow`'s `worker`; `fsdev run --worker` | **Removed**; P1 published the real pages | They described the link | A pointer to the published pages; the React path now selects a session the client found |

### Engine changes beyond the epic's D3 item (3)

The epic's [D3](../../epics/FIX-1786/DECISIONS.md#d3) item (3) reads "a server-only field on the
session record, set and checked when the session is created". P1 shipped it as three engine
changes, which the product owner approved on 2026-10-07:

- **A readonly guard on session state.** A top-level `.readonly()` field of a flow's session
  `stateSchema` is refused on any change after create, on every path that writes session state:
  a block, a tool, an action, and `fsdev run --seed-session` on an existing session.
- **A state filter on listing, inside the store.** `listSessions({ state })` and the route's
  `?state.<field>=` filter on readonly fields only, in the SQLite, Postgres, memory and filesystem
  stores' own queries. Any other field is refused with 400.
- **A schema refusal at create, on flows that bind their sessions.** A flow with a readonly field
  or a create check refuses a starting state its schema rejects. Other flows keep today's create.

Beside them, as planned under item (3): the optional `session.createCheck`, whose only store read
is one collection row at the creating caller's own scope; `session.serverOwned`; a dispatcher's
child `state`; and `ensureSessionRecord` taking the create request. The epic's D3 card text may
need a matching amendment. That is the epic's to make, and this amendment leaves
`specs/epics/FIX-1786/` untouched.
