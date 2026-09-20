# FIX-1457 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who owns
it and where it's checked. **[ER-19](#er-19) names three artifacts and only one has a producer** —
that is flagged in the rule itself rather than papered over, and it is
[Open 1](DECISIONS.md#open). **The set is open** ([ER-23](#er-23)): a child filed later inherits
every rule here without this document being re-gated.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | **A non-human seat owns the task.** A row that needs a person is **parked by the seat that owns it**, and the person answers through a **flow action carrying the request's own principal** — never by draining the board, and never by deriving a second person ([D2](DECISIONS.md#d2), [D7](DECISIONS.md#d7)) | **FIX-1455** — moved here when FIX-1458 was canceled; it is the row that renders a parked row and calls the action that answers it | FIX-1455's own gate · cross-spec review over the set · [ER-20](#er-20)'s wrap sweep |
| ER-2 | A row that needs a person is **parked, with a reason**. **Waiting on you** is that reading — not a new `TaskStatus` value and not a new column — and **Idle** is seat/session runtime. This binds the devtool surface too, which renders both ([D3](DECISIONS.md#d3)) | **FIX-1455**, with the devtool gap once filed | FIX-1455's own gate · cross-spec review |
| ER-3 | The reference consumer is **runnable by someone who clones it**, and its hired team **survives a redeploy** — seats, channels and boards come back | FIX-1455 (child epic) | FIX-1455's own set and its own gate |
| ER-4 | Every proving surface **composes** the W3 floor and the W4 first cut; none adds a layer of its own ([D1](DECISIONS.md#d1)) | FIX-1455 · the devtool gap · the DevForce gap — **each, once filed** | Each surface's own spec · [ER-20](#er-20)'s wrap sweep |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-5 | No child invents **Human, Team, Channel or Agent as an L1 type** | [D1](DECISIONS.md#d1). An L2 opinion that becomes L1 is maintained forever |
| ER-6 | No child builds a **parallel HITL plane**, a human-only side board agent seats cannot see, or a path that makes a person a **board drainer** | [D2](DECISIONS.md#d2). Work outside the org chart can be assigned but not tracked; a person racing agents for rows is the model the owner killed |
| ER-7 | No child **collapses board assignee and the seat registry** into one noun | [D3](DECISIONS.md#d3). They resolve to each other; a merge is the irreversible one |
| ER-8 | No child widens **L1 `TaskStatus`** for Waiting-on-you or Idle — **including to render a devtool column** | [D3](DECISIONS.md#d3). A UI's columns leaking into L1, and the new surface is a UI |
| ER-9 | No child folds **Collab RC** ([FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341)) into W5 as the whole epic | Parked, soft-related, and a different outcome |
| ER-10 | No child opens a W5 **ship** ticket while the W4 first cut is open | [D4](DECISIONS.md#d4). **The fence lifted on 2026-09-20**; the rule is kept as the record |
| ER-11 | No child builds **kitchen-sink-only APIs**, a KS-only durable store, or in-memory-only hire; and **no Lab product lands inside the kitchen-sink**. **Narrowed 2026-09-20:** a **basic DevForce configuration** is now a proving surface of its own ([D6](DECISIONS.md#d6)) — it runs **beside** the kitchen-sink, never inside it. **CyberForce stays out entirely** | A reference consumer that needs private APIs is not a reference. The original fence conflated *a Lab as product* with *a Lab as evidence*; the owner's restated objective wants the second and still refuses the first |
| ER-12 | No child plugs seats into `supervisor()` or `@flow-state-dev/patterns` factories **as L2 primitives** | Those are composition recipes, not the roster |
| ER-13 | No child teaches **nested or child sessions as the work control plane**. `parentSessionId` is provenance | [FIX-1408](https://linear.app/fixpoint-labs/issue/FIX-1408) / [FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440). Boards and tasks nest; sessions link |
| ER-14 | No child invents a **second skill registry** or a **second memory story** | [FIX-1356](https://linear.app/fixpoint-labs/issue/FIX-1356) / [FIX-1364](https://linear.app/fixpoint-labs/issue/FIX-1364). One register, one honesty story |
| ER-22 | No child builds **multi-human machinery** — a second principal, an audience routing between people, originator ≠ reviewer, a durable `reviewedBy:`, or an org chart of people as a product | [D7](DECISIONS.md#d7). All of it is [deferred with a revisit condition](DECISIONS.md#later), which is not the same as open. A child that needs it raises it ([ER-17](#er-17)) rather than building it |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-15 | **FIX-1455 runs its own epic lifecycle.** This epic does not drive its issues, does not spec them, and carries no spec PR for it | A nested child epic has its own gate and its own owner. Two coordinators on one set is the failure |
| ER-16 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear; a stale child fences its dependants whatever its PRs say |
| <a name="er-17"></a>ER-17 | A cross-cutting question a child hits is commented **up** on this PR, not decided locally | [DECISIONS.md](DECISIONS.md) is the single place; a local answer is a second authority |
| <a name="er-18"></a>ER-18 | **FIX-1467's** open walls may be leaned on and may not be closed without the owner. But it does **not** report complete with a **downstream-blocking** wall still open — **(a) which noun holds read-only handbooks, and what the migration does to existing `resources/*.md`**, and **(b) the grant model: whether an absent `references` key means ambient inherit, and what `resources:` still means for mutable access** — unless the owner signs off leaving it open. Its other walls may stay open where the exploration shows they bind no other row | **Retargeted 2026-09-20.** The clause is round 1's and its force is unchanged, but the walls it named were FIX-1458's, and FIX-1458 is canceled — a blocking clause whose owner no longer exists blocks nothing and releases nothing. FIX-1455 **teaches** the convention and declares seats with those keys, so an exploration that exits with either open releases its dependants onto nothing |
| <a name="er-23"></a>ER-23 | **The set is open.** The owner expects it to grow ([D6](DECISIONS.md#d6)), so filing a child against the objective is the **normal course** of this epic, not a re-scope and not a re-gate. A child filed later inherits every rule in this document, and the set table, the dependency graph and the path are refreshed to carry it | An epic whose set reads as closed makes the next needed child look like scope creep, and the objective explicitly names work that has no ticket yet |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| <a name="er-19"></a>ER-19 | **Workforce can be seen working**, on three artifacts, each observed on the real path rather than described — all under **one org identity, one user** ([D7](DECISIONS.md#d7)): **(a) the reference app** — someone clones the kitchen-sink, it hires a durable team, opens channels and boards, and still has them after a redeploy, with each seat reaching only the documents its own files name; **(b) the live view** — that same run is watched **as it unfolds** in devtool: channels, workers, and the activity moving between them, not reconstructed from a trace afterwards; **(c) the real configuration** — a basic DevForce runs one genuine task through a workforce end to end, and is watched doing it. **Rewritten a third time on 2026-09-20** against the restated objective; the previous version required an audience deriving to *a person in the org chart*, a mechanism the cancellation left with no owner | **(a) FIX-1455** — filed, held child epic. **(b) no producer** — the devtool gap is unfiled. **(c) no producer** — the DevForce gap is unfiled; its first build slice is Done ([FIX-1426](https://linear.app/fixpoint-labs/issue/FIX-1426)) and *basically working* is not. **Two of three legs have no owner**, so as written this condition is **not reachable by the current set** — stated here deliberately rather than discovered at wrap ([Open 1](DECISIONS.md#open)). Org identity comes from [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442), which W5 does not own but cannot wrap without |
| <a name="er-20"></a>ER-20 | Nothing the set shipped added an L1 type, a status enum value, a second work plane, or multi-human machinery | **Two checks, because one is not enough.** A cross-spec review over the set's specs before any ships, **and** a wrap-time sweep of the shipped child diffs — a spec-time check cannot see a child that ships what its spec never claimed, and invent-kills are this epic's core fence |
| ER-21 | The docs teach Workforce as something you **run and watch**, and the person as **someone the work asks a question of** — not as a second kind of worker and not as an approval widget bolted beside a seat | Whichever children ship the proving surfaces — their docs pass, plus the wrap-time docs polish |
