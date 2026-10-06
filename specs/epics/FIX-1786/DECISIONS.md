# FIX-1786 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The calls above any single issue. D1 is the sign-off surface. This epic runs under `epic-em`:
D2 to D5 are engineering calls I made and record here, with what would reverse each. Q1 is
open for Jake. Q2 and Q3 were asked on the in-flight inventory and are not asked again. The
model itself (workers as resources, delegates in session state, rooms removed, the vocabulary)
is decided in the PRD and the [concept](concept/CONCEPT.md), and is not reopened here.

## The tree

```mermaid
flowchart TD
  E["FIX-1786"] --> D1["D1 · nine children after the inventory, and a closure"]
  D1 -.->|"rejected"| X1["rename only · or fix privacy in place"]
  E --> D2["D2 · one coordinator flow, a routing setting"]
  D2 -.->|"rejected"| X2["coordinator and relay"]
  E --> D3["D3 · three Layer 1 changes, the rest Layer 2"]
  E --> D4["D4 · contract and org keys first, terms last"]
  E --> D5["D5 · a board is a session board unless people track it"]
  E --> Q1["Q1 · open · which flows run workers"]
  E --> Q["Q2 and Q3 · asked on the inventory"]
```

<a name="d1"></a>
## D1 · Nine refactor children after the inventory, and a closure, now

| | |
|---|---|
| **Instead of** | Rename only (FIX-1796 alone) · or fix privacy in place: keep seats, mailboxes and rooms, and narrow the org-locked hire and the boards |
| **Because** | A rename keeps the hole: an org-locked hire still reaches every member, and a drain still runs as whoever triggers it. A fix in place keeps six parts and three meanings of "shared", and each fix is a special case on a part the target model deletes. The inventory comes first because FIX-1763's mailbox children are in flight; starting under them makes each one a rebase |
| **Locks in** | A refactor across Workforce, the engine (three changes, [D3](#d3)), Shift Manager and the docs. Implementation waits on FIX-1787's merge-first rows. Work built on seats, mailboxes and rooms merges first and is refactored here, or closes |

**What would change my mind:** no app needing a second user or a worker of its own this year.
Then fix the hole in place and rename later.

![D1: nine children after the inventory, chosen, beside rename only and fixing privacy in place. Decides it: the model a reader learns, one rule against six parts. The price: nine issues and three Layer 1 changes. Flips if no app needs a second user or its own worker this year](figures/d1-the-set.svg)

It comes down to the model a reader learns: both cheaper options keep the six parts.

<a name="d2"></a>
## D2 · engineering · One coordinator flow, with a routing setting

| | |
|---|---|
| **Instead of** | Two flows: a coordinator that routes by judgment and keeps a board, and a relay with a fixed policy (the concept's open question) |
| **Because** | Both styles share every part the concept lists: the door, delegates in session state, the roster check, delivery into the delegate's own session, the one-answer record, the routing record. Only who picks differs, the model or a policy. Today's mailbox flow already carries best fit and wake-everyone in one flow. Two flows put the roster check in two places, two places to get a security check wrong. A board is session state any worker flow may keep; no board is not a second flow |
| **Locks in** | One coordinator flow with `routing: judgment \| best-fit \| round-robin \| everyone`. A relay is a coordinator with a fixed policy and no board |

**What would change my mind:** FIX-1791's spec finding that judgment routing needs a different
session shape for more than half the flow. Then split it, with the delegate check and the
answer record in one shared module.

<a name="d3"></a>
## D3 · engineering · Workforce stays Layer 2; Layer 1 changes are three

| | |
|---|---|
| **Instead of** | A Layer 1 worker noun with its own store · or per-org user keys faked inside Workforce |
| **Because** | Workers, coordinators and workstreams compose what ships: resources, scopes, sessions, projected collections, boards. Three things Workforce cannot fake: a scope key, a row rule, session state a caller can't write. [The end-state POC](#what-the-end-state-poc-showed) settled the third: the public create persists a caller's session state, so a link held there accepts the caller's own other worker, and a row only flow code writes outlives a deleted session id |
| **Locks in** | (1) user data keyed per (user, org) for every flow, FIX-1790, a persisted key change whose old records move to one org by an operator step, never read in two ([ER-3](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)); (2) "owner writes, org reads" on a row, FIX-1793, new work the 2026-09-23 security lock left for later; (3) session state a flow declares server-owned: the public create refuses caller state for it, and only flow code writes it. The worker link lives there, and so do a coordinator's delegates. FIX-1788 builds it, FIX-1791 consumes it. Flow instances and owner pins get deprecation markers, nothing more. A worker's own key for its private state is Layer 2, FIX-1788's, and so is reading a worker's configuration per run: a generator already resolves its tools per call ([ER-2](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)). Any other Layer 1 change comes back to this epic |

**What would change my mind:** a second consumer of a worker outside Workforce. Then a worker
noun in core earns its place. For (3), FIX-1788's spec needing the link before any flow code
runs, at admission: then a server-only field on the session record instead.

<a name="d4"></a>
## D4 · engineering · The contract and per-org keys first; the terms last, with docs moving with code

| | |
|---|---|
| **Instead of** | Rename first, then refactor · or every child at once |
| **Because** | FIX-1790 lands before FIX-1788: under today's cross-org user key, a user in two orgs would see one private roster in both. FIX-1789 lands before FIX-1788 because a configuration must name a registered worker flow. Terms go last because docs move with code (Jake, 2026-10-03): renaming ahead of behaviour documents parts that don't exist yet. So each child names its new surfaces in the new terms and documents its own behaviour; FIX-1796 removes what remains and publishes the glossary |
| **Locks in** | A seven-step critical path ([PLAN.md](PLAN.md#the-path)). Parallel windows: FIX-1789 beside FIX-1790; FIX-1791 beside FIX-1795; FIX-1793, FIX-1794 and FIX-1795 together. Every spec can be written once this one merges; the order gates builds only |

<a name="d5"></a>
## D5 · engineering · Each mailbox board becomes a session board, unless people track the work

| | |
|---|---|
| **Instead of** | One rule per file type (every lab board a workstream) · or keeping an org-scoped board as a third shape |
| **Because** | An org-scoped board is the shape this epic removes: any member's session drains it, and the session's user doesn't narrow it. A session board is private and needs no project; a workstream costs a project. So FIX-1792 asks one question per board: does the work outlive one conversation, and does a person track it? Yes makes it a workstream; otherwise, and when unclear, a session board. Goal fixtures that test board mechanics become session boards |
| **Locks in** | FIX-1792 waits on FIX-1793 for the workstream option. The per-board table is FIX-1792's spec. A session board that hands rows to a delegate on another flow can't be shared down the lineage, which stops at a flow, and still stays its own board: never one ledger for all its owner's sessions. FIX-1794 decides how ([ER-9](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) |

<a name="q1"></a>
## Q1 · open · Which flows can run a user's workers: a list the installation keeps, or a new kind of flow?

*Engineering detail is the ask here: this is a public contract every worker flow author writes
against.*

- **In plain terms.** An app author writes flows, and some of them run workers. Today a flow can
  run a hired worker when its settings accept the six worker keys and it has one action that
  takes a message. This epic adds two rules: a worker flow keeps a worker's state private, and
  an installation can keep a flow for standard workers only. The question is where an author
  says "this flow runs workers".
- **The trade-off.** The figure reads it: a list beside the flows, or a wrapper around each.
  The list keeps today's six keys and door, adds a standard-only flag per entry, and checks
  the private-state rule when the list is registered. A wrapper (`defineWorkerFlow()`) puts
  everything on the flow, where an author sees it, at the cost of a new public export and a
  second authority over a rule the schema already enforces. `worker-config.ts` rejects such a
  marker on purpose today.
- **My recommendation:** the list.
- **What would change my mind:** FIX-1789's spec finding that the private-state rule can't be
  checked from what a flow declares, so it needs a gate around resource writes at run time.
  Then the wrapper earns its place.
- **What being wrong costs:** with the list, a wrapper added later, additively. With the
  wrapper, a public export to deprecate, and every worker flow author migrates once.

![Q1, live: the installation lists its worker flows, recommended, beside a new defineWorkerFlow wrapper. Decides it: how many authorities decide what a worker flow is. The price: the contract is in two places an author reads. Flips if the private-state rule can only be checked at run time](figures/open-worker-contract.svg)

It comes down to authorities: the wrapper makes a second one over the schema's rule.

<a name="q2"></a>
## Q2 · asked on the inventory · Private projects lift FIX-1763's fence; FIX-1762's stack merges first

Asked of Jake on [the inventory](https://linear.app/fixpoint-labs/issue/FIX-1786#comment-9e837aa5),
call 1; not asked again here. The goal doesn't need private projects; the PRD does. A yes adds a
leg-b step that makes one, so the closure proves it. **My recommendation:** yes to both. FIX-1763's own fence left
"dual org/user later via a create-time flag, same membership model, no second project type",
and private or shared at create is that flag. FIX-1762's locks (one optional remote per
project, a worktree mapped from it, side files outside the checkout, no whole-repo copy or
auto-commit as the user, the FIX-1766 host-loss overlay) don't depend on scope, and FIX-1793
carries them either way. **If he says no:** private projects leave FIX-1793, leg b keeps its shared
project only, and a single user's own work is visible to the org.

<a name="q3"></a>
## Q3 · asked on the inventory · Close FIX-1774 and FIX-1777 into FIX-1791 and FIX-1794

Call 2 on [the inventory](https://linear.app/fixpoint-labs/issue/FIX-1786#comment-9e837aa5);
not asked again here. Either way, FIX-1791 carries FIX-1774's dogfood legs and its *not done
if* list, and FIX-1794 carries FIX-1777's "runs as the filer" rule, both restated on the new
model. Both issues say so in Linear.

## Who owns what

![Who owns what: twelve cross-cutting rules by the nine refactor children and the closure, each rule with exactly one decides or builds cell](figures/ownership.svg)

The matrix holds ER-1 to ER-12; ER-13 onward are fences and process that bind every child
alike. FIX-1788 decides what a worker is, so the coordinator, the library and the conversion
consume it rather than define their own. FIX-1789 owns attribution on shared writes, because it
is the contract's private-state rule seen from the shared side. FIX-1793 owns the one new
engine rule. The closure only checks.

## Decided in review, recorded so no child reopens them

- **A workstream is a project entry plus its lead's workstream session**, stored at
  `workstreams/<project>/<workstream>`, with project progress computed. The PRD's
  recommendation, adopted.
- **`MAILBOX.md` becomes `WORKER.md`, and old files are refused loudly** with the conversion in
  the message. The PRD's recommendation, adopted.
- **No transcript resource is built.** It is out of scope in the PRD; copy or projection stays
  punted. The coordinator's routing record is built.
- **FIX-1796 leaves channel-kind paths alone**: `workforce/flows/channels/<kind>.ts` and
  `CHANNEL.md`'s `flow:`. Channels are out of scope; nothing renames them silently.
- **Model variants carry into forks and the library.** Codex, Claude and Cursor variants are
  separate workers sharing core instructions (the 2026-10-04 lock). That lock's ownership half
  is superseded: workers are private, and standard workers are read-only projections.
- **Per-org user data does not dual-read.** A record stored before under the cross-org key would
  read in every org its user belongs to, the leak FIX-1790 exists to close, and the owner-pinned
  cell already refuses that fallback. It moves to the one org it can be attributed to by an
  operator step, or stops with `migration-required`; nothing is deleted ([ER-3](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)).
  Reversed in review (Jake, Codex) from a dual-read.
- **The privacy spine is proved when it merges**, not only at the end: leg c's worker steps and
  the control run on FIX-1788's merge commit, and a failure holds the coordinator and the
  library from merging ([ER-30](BUSINESS-RULES.md#the-closure)). From review (Jake).
- **Private projects are proved if they are built.** If Q2 holds, leg b makes one and Bob can't
  reach it; otherwise ER-7's private half would ship unchecked. From review (Jake, Cursor).
- **ER-14 forbids a second registry of workers**, not Q1's list of worker flows. From review.
- **A worker names the flow that runs it.** An installation has many worker flows (the built-in
  agent, the coordinator, the app's own), each one singleton copy that every worker naming it
  shares. Making flows singletons doesn't put every worker on `agent` ([ER-1](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)).
  From review (Jake); the concept and its workers figure now say so.
- **A board stays its own when its rows cross a flow.** A user-scoped ledger spans every session
  its owner has, and a board takes any pending row in it, so one of Alice's sessions could claim
  another's rows. ER-9 now requires that only a board's own drains claim its rows, and leaves how
  to FIX-1794's spec; a task-board change comes back here. From review round 2 (Codex).
- **A worker's configuration is data, read per run.** On a singleton, `ctx.flow.config` is one
  frozen bag for every worker, and `seatTools` carries live blocks a stored row can't hold. So the
  contract stores names, resolves them when a session loads its worker, and a flow reads that
  configuration per run ([ER-2](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1789).
  From review round 2 (Codex).
- **Shift Manager lives at `packages/shift-manager`.** #2759 (FIX-1770) moves it there and lands
  first among the merge-first rows; PRs that edit the lab rebase after it.
- **Checked against `main` at `74f9a4f68`:** a project room and the mailbox boards are as
  [EVOLUTION.md](EVOLUTION.md#where-todays-code-differs-checked-against-main) states; 33
  `MAILBOX.md` files, 15 with boards (the concept's 32 and 14 predate a FIX-1778 fixture).

## What the end-state POC showed

- **Built:** a singleton flow on the real engine, with the worker link in session state, in a
  user-scoped row only flow code writes, and, as the control that must fail, in session state
  over org-scoped workers. Its door drains a lineage-shared session board.
- **See it:** `bash specs/epics/FIX-1786/poc/singleton-worker-link/run.sh`, 12 legs
  ([README](poc/singleton-worker-link/README.md)).
- **Showed:** the premise holds within one flow: the session loads its worker, and the task child
  runs as the owner and settles the row. Another user's link reads nothing; the control honours
  it. Three things don't hold. A session-state link accepts the caller's own other worker, seeded
  through the public create, and a flow-owned row outlives a deleted session id. A user's
  workers share every `flowIsolation` cell. A lineage board can't reach a worker on another flow.
- **Changed:** [D3](#d3)'s third Layer 1 change is definite, as server-owned session state.
  FIX-1788 also keys a worker's private state by the worker and moves the per-seat cells
  ([ER-1](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)). A board whose rows cross a flow
  can't use its lineage ([ER-9](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1794;
  [D5](#d5)); the POC's answer, the owner's user scope, was struck in review round 2. The FIX-1788
  and FIX-1794 split holds. Variants: none.

## How it got here

- **Drafted (Oct 6)** from the PRD on FIX-1786, its Architect guidance, the concept doc and the
  code on `main`. FIX-1788 to FIX-1797 filed; FIX-1787 kept as the inventory.
- **The inventory landed (Oct 6)** while drafting: Q2 and Q3 reference its two asks, the
  carries into FIX-1791 and FIX-1794 are recorded, and #2759 lands first.
- **POC (Oct 6)**: D3's third change became definite, as server-owned session state, and
  FIX-1788 gained the worker key, because the run showed a caller-seeded link to the caller's own
  other worker is honoured and a singleton's isolated cells are shared by every worker. ER-9
  gained the flow-boundary rule, because a cross-flow child roots its own lineage.
- **Review round 1 (Oct 6)**: per-org user data stopped dual-reading old records (ER-3); the
  closure gained an early leg-c run at FIX-1788's merge (ER-30) and a private-project step if Q2
  holds; ER-14 names what it forbids. Issue-level notes went to the children, and FIX-1798 was
  filed outside the epic to remove flow instances and owner pins after FIX-1788 (ER-20).
- **A correction from review (Oct 6)**: the concept, the box and ER-1 now say each worker names its own
  flow, after Jake read the PRD as putting every worker on one flow. No decision moved.
- **Review round 2 (Oct 6)**: ER-9 keeps each board its own, because the POC's user-scoped
  answer let one of an owner's sessions claim another's rows; ER-2 makes a worker's
  configuration stored data read per run; ER-7's private half waits on Q2, as the Q2 card said.
  The flow-match check on a session link went to FIX-1788 as a note.

**Open: Q1.**
