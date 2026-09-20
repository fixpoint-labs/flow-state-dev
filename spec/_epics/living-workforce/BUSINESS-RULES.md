# FIX-1457 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who owns
it and where it's checked. **ER-19's owner is provisional, not committed** — FIX-1455 holds it
unless the assemblies cut says otherwise — and that is flagged rather than papered over.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | **A non-human seat owns the task.** People sit in the same org chart as the agent seats — inventory, members, principals, channel membership — and act on a parked row through **flow actions bound to a principal**, never by draining the board ([D2](DECISIONS.md#d2)) | FIX-1458 ([D2](DECISIONS.md#d2)) | FIX-1458's spec review · the assemblies proof |
| ER-2 | A row that needs a person is **parked, with a reason and an audience**. **Waiting on you** is that reading — not a new `TaskStatus` value and not a new column — and **Idle** is seat/session runtime | FIX-1458 ([D3](DECISIONS.md#d3)) | FIX-1458's spec review · cross-spec review over the set |
| ER-3 | The reference consumer is **runnable by someone who clones it**, and its **org chart survives a redeploy** — the agent seats and the **durable bind** to the people who owe sign-offs, so a redeploy does not forget who owed one | FIX-1455 (child epic) | FIX-1455's own set and its own gate |
| ER-4 | Assemblies **compose** the W3 floor and the W4 first cut; they add no new layer of their own | **Conditional** — FIX-XXX · assemblies once cut, else FIX-1455, which composes them instead ([Open 2](DECISIONS.md#open)) | The assemblies spec once cut, else FIX-1455's own set |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-5 | No child invents **Human, Team, Channel or Agent as an L1 type** | [D1](DECISIONS.md#d1). An L2 opinion that becomes L1 is maintained forever |
| ER-6 | No child builds a **parallel HITL plane**, a human-only side board agent seats cannot see, or a path that makes a person a **board drainer** | [D2](DECISIONS.md#d2). Work outside the org chart can be assigned but not tracked; and a person racing agents for rows is the drain seat the flip removed |
| ER-7 | No child **collapses board assignee and the seat registry** into one noun | [D3](DECISIONS.md#d3). They resolve to each other; a merge is the irreversible one |
| ER-8 | No child widens **L1 `TaskStatus`** for Waiting-on-you or Idle | [D3](DECISIONS.md#d3). A UI's columns leaking into L1 |
| ER-9 | No child folds **Collab RC** ([FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341)) into W5 as the whole epic | Parked, soft-related, and a different outcome |
| ER-10 | No child opens a W5 **ship** ticket while the W4 first cut is open | [D4](DECISIONS.md#d4). Building against a floor in motion means building twice |
| ER-11 | No child builds **kitchen-sink-only APIs**, a KS-only durable store, or in-memory-only hire; and no Lab **product** (DevForce, CyberForce) lands in the kitchen-sink | A reference consumer that needs private APIs is not a reference. The Labs are finish-line deliverables; KS teaches their conventions |
| ER-12 | No child plugs seats into `supervisor()` or `@flow-state-dev/patterns` factories **as L2 primitives** | Those are composition recipes, not the roster |
| ER-13 | No child teaches **nested or child sessions as the work control plane**. `parentSessionId` is provenance | [FIX-1408](https://linear.app/fixpoint-labs/issue/FIX-1408) / [FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440). Boards and tasks nest; sessions link |
| ER-14 | No child invents a **second skill registry** or a **second memory story** for human principals | [FIX-1356](https://linear.app/fixpoint-labs/issue/FIX-1356) / [FIX-1364](https://linear.app/fixpoint-labs/issue/FIX-1364). One register, one honesty story, whoever sits in the seat |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-15 | **FIX-1455 runs its own epic lifecycle.** This epic does not drive its issues, does not spec them, and carries no spec PR for it | A nested child epic has its own gate and its own owner. Two coordinators on one set is the failure |
| ER-16 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear; a stale child fences its dependants whatever its PRs say |
| ER-17 | A cross-cutting question a child hits is commented **up** on this PR, not decided locally | [DECISIONS.md](DECISIONS.md) is the single place; a local answer is a second authority |
| ER-18 | The exploration's **four open walls may be leaned on, and may not be closed** without the owner. But FIX-1458 does **not** report complete with a **downstream-blocking** wall still open — **the principal bind and action authorization**, and **what a redeploy must round-trip to keep that bind** — unless the owner signs off leaving it open. The other two may stay open where the exploration shows they bind neither FIX-1455 nor the assemblies cut | Locked input: a lean is evidence, a close is a decision. The second sentence is the other half — a prerequisite that reports complete while the contract its dependants need is undecided releases them onto nothing. **The two named walls were renamed, not added, by the [D2](DECISIONS.md#d2) flip**: the old pair asked about a human *seat kind*, which Model B deletes, so they could no longer name what blocks FIX-1455 |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-19 | In a running reference assembly **opened under org identity**: a coordinator assigns a board row to a **non-human seat**, that seat **parks it with a reason**, the parked row's audience derives to a **person in the org chart**, that person **approves or supplies the input through a principal-bound flow action**, and **the flow continues from there** — observed on the real path, not described. Org-bound execution is part of the condition because it is half of what the objective promises, and without it the epic could close with that half unproved. **Rewritten by the [D2](DECISIONS.md#d2) flip**: the old condition asked for a person to *drain* a row, which Model B forbids (ER-6) — an epic could have wrapped on the mechanism the flip removed | **Provisional owner: FIX-1455**, unless the assemblies cut says otherwise ([Open 2 and 3](DECISIONS.md#open)). Provisional is a default place to look, not a commitment, and the sign-off treats it as the epic's one structural gap. Org identity is supplied by [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442), which W5 does not own but **cannot wrap without** |
| ER-20 | Nothing the set shipped added an L1 type, a status enum value, or a second work plane | **Two checks, because one is not enough.** A cross-spec review over the set's specs before any ships, **and** a wrap-time sweep of the shipped child diffs — a spec-time check cannot see a child that ships what its spec never claimed, and invent-kills are this epic's core fence |
| ER-21 | The docs teach the person as **a member of the org chart who acts through bound actions** — not as a second kind of worker, and not as an approval widget bolted beside a seat | Whichever child ships the human-input path — its docs pass |
