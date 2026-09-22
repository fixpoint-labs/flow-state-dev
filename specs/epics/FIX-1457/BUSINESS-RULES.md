# FIX-1457 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who owns
it and where it's checked. **The done condition is three named exit proofs** —
[ER-Devtool](#er-devtool), [ER-DevForce](#er-devforce), [ER-Collab](#er-collab) — and **as of
2026-09-22 all three have a producer**: [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)
and [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502) between them,
[FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496), and
[FIX-1497](https://linear.app/fixpoint-labs/issue/FIX-1497). **None has been run**, and a filed
ticket is still not a green row. The state of each is flagged in the rule itself rather than papered
over.
**The set is open** ([ER-23](#er-23)): a child filed later inherits every rule here without this
document being re-gated.

## What every exit proof must satisfy

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | **A non-human seat owns the task.** A row that needs a person is **parked by the seat that owns it**, and the person answers through a **flow action carrying the request's own principal** — never by draining the board, never by deriving a second person ([D2](DECISIONS.md#d2), [D7](DECISIONS.md#d7)) | **[FIX-1497](https://linear.app/fixpoint-labs/issue/FIX-1497)**, the ER-Collab producer — re-owned 2026-09-20 when kitchen-sink left the set, **named 2026-09-22**; it is the proof that runs seats filing, assigning and draining | That child's gate · cross-spec review · [ER-20](#er-20)'s wrap sweep |
| ER-2 | A row that needs a person is **parked, with a reason**. **Waiting on you** is that reading — not a new `TaskStatus` value and not a new column — and **Idle** is seat/session runtime ([D3](DECISIONS.md#d3)) | **[FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)** — it renders both, and [row 4](#er-devtool) of the checklist is the row it was filed for. ER-Devtool has **two** producers since 2026-09-22; this rule is wholly 1481's, not [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502)'s | That child's gate · cross-spec review |
| ER-3 | Every exit proof runs against a **live hired Workforce** — a real hire, real seats, real channels, durable across the run — never a fixture, a mock or a hand-built harness standing in for one. **Rewritten 2026-09-20**: it used to require the kitchen-sink reference app, which is no longer in the set | **[FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496)**, the ER-DevForce producer — **named 2026-09-22**; its path is what stands a workforce up, which is why [ER-26](#er-26) makes the other two proofs' *runs* wait on it | Each proof's own gate · [ER-20](#er-20)'s wrap sweep |
| ER-4 | Every proof **composes** the W3 floor and the W4 first cut; none adds a layer of its own ([D1](DECISIONS.md#d1)) | Each of the three — **all filed as of 2026-09-22**, so this is no longer conditional | Each proof's own spec · [ER-20](#er-20)'s wrap sweep |
| <a name="er-26"></a>ER-26 | **New 2026-09-22. No exit proof's *run* is graded before a live hired Workforce exists, and the path that stands one up is [FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496).** [ER-3](#what-every-exit-proof-must-satisfy) and [ER-Devtool](#er-devtool) both forbid a fixture, a wrapper or code written only to make an inspection possible, so the checklist has nothing legitimate to read until one is standing — and **row 6 is the sharp case: no tree in the repository has a sealed document today**, so 1481's row-6 code can be entirely correct and the row still cannot go green. **This fences the run, not the code.** FIX-1481's and FIX-1502's implementation PRs are **not** blocked by it and must not be sequenced behind it | The ER-Devtool producers consume it; [FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496) discharges it | The checklist run itself · [ER-20](#er-20)'s wrap sweep |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-5 | No child invents **Human, Team, Channel or Agent as an L1 type** | [D1](DECISIONS.md#d1). An L2 opinion that becomes L1 is maintained forever |
| ER-6 | No child builds a **parallel HITL plane**, a human-only side board agent seats cannot see, or a path that makes a person a **board drainer** (*Model A*) | [D2](DECISIONS.md#d2). A person racing agents for rows is the model the owner killed |
| ER-7 | No child **collapses board assignee and the seat registry** into one noun | [D3](DECISIONS.md#d3). They resolve to each other; a merge is the irreversible one |
| ER-8 | No child widens **L1 `TaskStatus`** for Waiting-on-you or Idle — **including to render a Devtool column** | [D3](DECISIONS.md#d3). A UI's columns leaking into L1, and ER-Devtool is a UI proof |
| ER-9 | No child folds **Collab RC** ([FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341)) into W5, and **collab is never the whole of W5** — [ER-Collab](#er-collab) is one of three proofs, not the epic | Parked, soft-related, a different outcome. **Widened 2026-09-20**: *collab RC as the whole of W5* is a named invent-kill |
| ER-10 | No child opens a W5 **ship** ticket while W4's first cut is open. **Polish may start now** | [D4](DECISIONS.md#d4). **Restated 2026-09-20, and it stands**: the first-cut issues are Done but [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) is *In Review*, not closed |
| ER-11 | No child builds **kitchen-sink-only APIs**, a KS-only durable store, or in-memory-only hire; and **no Lab product lands inside the kitchen-sink**. **Re-narrowed 2026-09-20 ([D8](DECISIONS.md#d8)):** the **thinnest DevForce path that produces a real artifact is in, and stops there**. Unbounded Lab product delivery is out; **W5 is not "rebuild the whole Lab product"**; **CyberForce stays out** this cycle | The fence conflated *a Lab as product* with *a Lab as evidence*. The recalibration wants the second, explicitly, and still refuses the first |
| ER-12 | No child plugs seats into `supervisor()` or `@flow-state-dev/patterns` factories **as L2 primitives** | Those are composition recipes, not the roster |
| ER-13 | No child teaches **nested or child sessions as the work control plane**. `parentSessionId` is provenance | [FIX-1408](https://linear.app/fixpoint-labs/issue/FIX-1408) / [FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440). Boards and tasks nest; sessions link |
| ER-14 | No child invents a **second skill registry** or a **second memory story** | [FIX-1356](https://linear.app/fixpoint-labs/issue/FIX-1356) / [FIX-1364](https://linear.app/fixpoint-labs/issue/FIX-1364). One register, one honesty story |
| ER-22 | No child builds **multi-human machinery** — a second principal, an audience routing between people, originator ≠ reviewer, a durable `reviewedBy:`, or an org chart of people as a product | [D7](DECISIONS.md#d7). All of it is [deferred with a revisit condition](DECISIONS.md#later), which is not the same as open. A child that needs it raises it ([ER-17](#er-17)) |
| <a name="er-24"></a>ER-24 | **No child nests kitchen-sink under W5 again.** [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) owns the reference-consumer rebuild on its own lifecycle | **New 2026-09-20** ([D9](DECISIONS.md#d9)). It has been nested once already; a named kill is what stops a third pass |
| ER-25 | No child opens a **new substrate epic disguised as polish**. Work that needs new substrate is a **gap in W3 or W4** and is commented up ([ER-17](#er-17)), not built here | **New 2026-09-20.** A QA epic that grows substrate stops being a QA epic, and the growth arrives labelled *polish* |

## How the set is run

| # | Rule | Because |
|---|---|---|
| <a name="er-15"></a>ER-15 | **This epic drives no child epic.** **Rewritten 2026-09-20** — it used to say FIX-1455 runs its own lifecycle *as a member of this set*, and that framing is wrong now: kitchen-sink is a **sibling** epic, soft-related, **not a child and not in the set**. It is not specced here, not driven here, and carries no row in the set table | Two coordinators on one set is the failure the old rule guarded against. The new failure is a sibling read as a child, which is what re-nested it last time ([ER-24](#er-24)) |
| ER-16 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear; a stale child fences its dependants whatever its PRs say |
| <a name="er-17"></a>ER-17 | A cross-cutting question a child hits is commented **up** on this PR, not decided locally | [DECISIONS.md](DECISIONS.md) is the single place; a local answer is a second authority |
| <a name="er-18"></a>ER-18 | **MET, 2026-09-20.** The clause required [FIX-1467](https://linear.app/fixpoint-labs/issue/FIX-1467) not to report complete with either downstream-blocking wall open. **It merged answering both**: the noun that holds read-only handbooks is **`references/`**; the migration for existing `resources/*.md` is **`clearShadowedReferences` / `describeShadowedReferences`**; and the grant model is settled — a `references/` document is ambient down the org → team → worker tree and read-only, while `resources:` remains the explicit grant for mutable state, with a `references/` file refused if it declares `writable`, `llmWritable`, `render` or `flowIsolation` | Recorded as **met with what met it**, not left standing as an open blocking clause. A satisfied fence that still reads as open fences its dependants onto nothing, which is the same defect in the other direction |
| <a name="er-23"></a>ER-23 | **The set is open.** The owner expects it to grow, so **filing a child against one of the three exit proofs is the normal course** of this epic — not a re-scope and not a re-gate. A child filed later inherits every rule here, and the set table, the dependency graph and the path are refreshed to carry it | Load-bearing now: **every** exit proof is unfiled, so an epic whose set reads as closed reads as an epic that is finished |

## The proof

**ER-19 is retired**, replaced on 2026-09-20 by the three rules below. It described the done
condition as three *surfaces* — a reference app, a live view, a real configuration — and the
reference-app leg left the set with kitchen-sink. A child following an old link to ER-19 should read
these three instead.

| # | The epic is done when | Proved by |
|---|---|---|
| <a name="er-devtool"></a>**ER-Devtool** | **The documented Devtool checklist below is green on a live hired Workforce** ([ER-3](#what-every-exit-proof-must-satisfy)), **with no special wrapper** — no bespoke debug app, no fixture panel, no code written only to make the inspection possible | **Two producers, not one, since 2026-09-22.** [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) (*In Spec Review*, [#2025](https://github.com/fixpoint-labs/flow-state-dev/pull/2025)) owns **rows 4 and 6**; [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502) (*Backlog*) owns **row 5**, the org-level inventory view, and is **blocked by [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486)**; rows 1–3 ride [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320), which this epic does not run. **1481 still verifies the whole checklist**; 1502 builds the consumer 1481 deferred. **Nothing has been observed on a running workforce** — rows drafted below against what the surfaces expose today, **rows 4 and 6 fail as written**, rows 1–2 derived from source, and the run itself waits on [ER-26](#er-26). **A filed ticket is not a green row** |
| <a name="er-devforce"></a>**ER-DevForce** | **One DevForce path completes and produces a real artifact** — code, a PR, or a work product that exists outside the run — **not a mock and not a transcript**, with seats and channels used honestly rather than stubbed past | **[FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496)**, *In Spec Review*, spec [#2023](https://github.com/fixpoint-labs/flow-state-dev/pull/2023) at head `25e7507`. A four-gap delta on the existing `goals/devforce-lab/`, not a new Lab tree. **Which artifact counts — the EM's cut, taken.** *Real* is three falsifiable properties, and the proof runs **one automated leg**: the temp-directory repository gains a **bare clone at a declared path the run pushes to**, so the artifact resolves at its address after the goal's process has exited, needing `git` and a temporary directory but **no `gh`, no token and no network** (its `PLAN.md` S3, `BR-1`, `BR-15`). The **credentialed pull-request leg is documented as the human release run** and is never inferred from whether `gh` happens to be installed (`BR-14`) — one leg in CI, and the verdict names which. **Channels are in, not optional:** 1496 kept channel driving rather than deferring it, because this rule's ratified wording says *with seats and channels used honestly rather than stubbed past*, which puts channels inside the criterion (its *Decided, not asked* → [the channel](https://github.com/fixpoint-labs/flow-state-dev/blob/spec/FIX-1496/specs/issues/FIX-1496/DECISIONS.md#channel)). **The cut is proposed, not approved** — 1496's own direction gate is still open, and this row records what it proposes, not a settled epic decision |
| <a name="er-collab"></a>**ER-Collab** | **≥2 seats across ≥1 channel**: work **filed**, **assigned**, **drained**, and a **cross-seat handoff or reply observed in Devtool**. One graded scenario, run on the real path | **[FIX-1497](https://linear.app/fixpoint-labs/issue/FIX-1497)**, *Backlog*, **no spec yet**. Composes boards ([FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385)), inventory ([FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405)), manager-queue ([FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430)), dispatch honesty ([FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440)). *Observed in Devtool* makes it depend on ER-Devtool, which is why it is **held behind [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)** — recorded in Linear as a soft dependency, not a hard block, and 1497's own body says to treat it that way unless its assignee finds a hard ordering. **[FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474) is not this producer** — its own body keeps this gate on today's separate paths and forbids widening it until that child lands |
| <a name="er-20"></a>ER-20 | Nothing the set shipped added an L1 type, a status enum value, a second work plane, multi-human machinery, or new substrate under a polish label ([ER-25](#what-no-child-may-do)) | **Two checks.** A cross-spec review over the set's specs before any ships, **and** a wrap-time sweep of the shipped child diffs — a spec-time check cannot see a child that ships what its spec never claimed |
| ER-21 | The docs teach Workforce as something you **run, watch and prove** — and the person as **someone the work asks a question of**, not a second kind of worker | Whichever children ship the proofs, plus the wrap-time docs polish |

### <a name="devtool-checklist"></a>ER-Devtool · the checklist, drafted

**Six areas, six pass/fail rows** — the Architect named the areas and left the detail to the EM, and
*"looks good"* is not a proof. Each row says what passes and what the surface exposes **today**, read
from `packages/devtool/src` and `packages/workforce` on `main`. **This is a source read, not a live
run**: no row below has been observed against a running hired Workforce, which is the proof itself.

| # | Passes when | Today |
|---|---|---|
| 1 · **Roster** | Every seat the hire minted is its own row in the instance list, selectable by its exact seat id, showing its own sessions — and legible **as a seat** (its worker kind, its team), not as a bare flow id | `hireWorkforce` seats are registered flow instances and the list is one row per instance, so the rows appear. **Whether a row reads as a seat is unverified** |
| 2 · **Channels** | Every open channel appears, addressed `<teamId>.<channelName>`, with its members, and its transcript is readable | Channel instances are registered flows, so they appear in the same list. **Membership lives in the channel inventory collection, which has no Devtool view** — see row 5 |
| 3 · **Boards** | For a workforce that ran a board, the board renders with its counts ribbon and per-row goal, status and assignee — **and which boards are open right now is answerable** | `task-collections-view` renders all of that from `task-change` / `task-board-meta` stream items, but it is **session-scoped**: a board is visible only by opening the session whose stream carried it. There is no standing board browser |
| 4 · **Parked rows** | A parked row is visible **with its reason** without expanding raw JSON, and Waiting-on-you reads as a view over parked + reason ([ER-2](#what-every-exit-proof-must-satisfy)) — **never as a new status value** ([ER-8](#what-no-child-may-do)) | **Fails as written.** `parked` is a status pill and a counts-ribbon entry; the row's columns are id, goal, status, assignee, child session, kind. **The reason is only inside the per-row `view` JSON expander** |
| 5 · **Inventory** · **[FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502)** | The three org-scoped inventory collections — `inventory/seats/*`, `inventory/channels/*`, `inventory/members/*` — are readable for a live org, so *who exists* and *who is in which channel* are answerable without walking folders | The Resources panel is **session-scoped** (`GET /sessions/:id/debug/resources`) and **off unless `FSDEV_DEBUG_ENDPOINTS=1`**. Inventory is reachable only through a session whose flow declares those collections; **there is no org-level inventory view**. **Not buildable in W5 today** — see the paragraph below |
| 6 · **Resources + references** | A seat's documents are visible, and a **read-only `references/` document is distinguishable from a mutable `resources/` one** — the distinction FIX-1467 just settled is legible in the inspector | **Fails as written.** The resources tree carries a scope badge (`session` / `user` / `org`) and **nothing marking read-only**. References install as org-scoped resources, so they are visible but **indistinguishable from mutable org resources** |

**Two rows fail today and one is half-built, and that is the finding** — ER-Devtool is not a polish
pass over a working inspector. Rows 4 and 6 need rendering that does not exist; rows 3 and 5 are
session-scoped where the proof needs an org-level reading. **Rows 1–3 read on the instance and
session surfaces [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) already owns** and ride
it. **No row may be passed by adding a status enum value** ([ER-8](#what-no-child-may-do)) or by
building a wrapper app — the checklist says *no special wrapper* precisely because a bespoke panel
would pass every row and prove nothing.

**The split of the other three, corrected 2026-09-22: rows 4 and 6 are
[FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)'s. Row 5 is
[FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502)'s.** It was three-and-three from
2026-09-20 until FIX-1481's spec deferred row 5 on the ground that *"the reader is already owned by
[FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477) PR-C"* — **and that was false**, so the
deferral left row 5 owned by nobody. Verified on `origin/main`: FIX-1477's `Roster` reads
**`workforce/roster/*`**, [FIX-1475](https://linear.app/fixpoint-labs/issue/FIX-1475)'s durable
hired-roster collection (`packages/workforce/src/roster/collections.ts`, whose own header says it is
*"not the seat inventory, and deliberately beside it"*), while this row names **`inventory/*`**
(`packages/workforce/src/inventory/collections.ts`). Different collection, different question, and
no reader in any plan. FIX-1502 was filed to own it; 1481 keeps verifying the row on the checklist.

**Why FIX-1502 is blocked rather than merely unscheduled.** Four gaps, all verified on
`origin/main`, and only the last is Devtool's.

1. **Nothing opens an inventory.** `openInventory` has no call site under `apps/` in any
   `.ts`/`.tsx` file, so there are no rows for a reader to serve.
2. **Nothing may read one over the wire.** All three collections are `scope: "org"` and declare
   **no `client` config** (`packages/workforce/src/inventory/collections.ts`), and the state-read
   route refuses a collection without one — `config.client?.state?.read !== true` returns 403
   (`packages/engine/src/routes/resource-routes.ts`, `handleListCollectionState`).
3. **The read is session-addressed.** It resolves against the session's *owning* flow, and the only
   flow declaring the three collections is the workforce **channel** flow
   (`packages/workforce/src/channel/channel-flow.ts`), so today they are reachable solely through a
   channel's own session.
4. **And an org-scoped read cannot be told *which* org to read.** Its storage key comes from the
   execution's `orgId` (`createExecutionContext` → `resolveOrgStorageKey`), which is the org the
   **session** carries. That org is set once at creation from the configured resolver:
   `body.orgId` is **never consulted**
   ([FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442)), and the listing has **no `orgId`
   query fallback** by design. Where no resolver is configured, it is `DEFAULT_ORG_ID`
   ([`projects-on-org-scope.md`](../../../apps/docs/guides/projects-on-org-scope.md): *"Configure
   no `resolvePrincipal` and everything runs under `DEFAULT_ORG_ID`"*); where one is, it is that
   principal's org.

**So the gap is that you cannot *choose* the org — not that no org is reachable.** State it that
way round, because the sloppy version is wrong in a way that matters: **the surface can be asked,
it just always answers with the same org.** Declaring a `client` config on these collections would
not add an org picker; it would open the read onto whichever org the session already holds.
**Supplying the ability to select one is exactly
[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486)'s subject**, and building it inside W5
is the [ER-25](#what-no-child-may-do) substrate growth the owner fenced — raised up per
[ER-17](#er-17) rather than answered locally.

**Plan the successor against selection, not against access.** An access story invites a child to
widen a read; a selection story says the work is an address the request can carry, which is the
shape FIX-1486 actually has.

> **Two corrections inside the correction, because this mechanism has now been got wrong twice.**
>
> **One.** FIX-1481's and FIX-1502's own texts justify this block as a live **BP-031 hole** — *"a
> session's org comes from the request body, so anyone could claim any org."* **That is no longer
> true on `main`.** [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) (`b48158a0d`,
> 2026-09-21) made `handleCreateSession` stop consulting `body.orgId` *at all*; the hole is closed.
> The block stands on the four gaps above instead — not a security hole, an **absent addressing
> axis**. A child must not cite the closed hole as live.
>
> **Two.** The first draft of *this* amendment replaced it with a second false claim: that the
> session listing *"withholds every row that is not on that org."* It does not. `handleListSessions`
> filters on `isOrgAttributed(s) && (allowed === undefined || s.orgId === DEFAULT_ORG_ID)`, and
> `allowed === undefined` means *no flow in this app authenticates*: `authorizeManagementRoute`
> returns `ALLOWED` at its **first** guard when the host is on the default resolver and nothing
> authenticates, so the anonymous branch is never reached at all, and the branch that *is* reached
> in a mixed app always returns a `Set` (`packages/engine/src/routes/route-auth.ts`). The second
> conjunct is therefore vacuously true on that path and **only unattributed legacy rows are
> withheld**; the `DEFAULT_ORG_ID` narrowing reaches that filter solely in the *mixed-app
> anonymous* case.
>
> **The clause is dropped rather than repaired, because it was doing no work even when true**:
> that route lists **sessions**, and this rule is about reading **inventory resources**. It was
> never evidence for the claim it was attached to. Caught on sibling PR
> [#2037](https://github.com/fixpoint-labs/flow-state-dev/pull/2037), whose re-derivation the
> wording above now matches, and corrected here before merge. The conclusion never depended on it.
>
> **What all three wrong versions had in common** is that they reasoned about handlers instead of
> reading them, and each landed on *access* — which org can be got at — when the real constraint
> is **selection**. A child that inherits the access framing will try to widen a read.
