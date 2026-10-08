# FIX-1786 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Lineage that spans more than one child. Two predecessor epics are superseded in part, one
lock is amended, and today's code differs from the target in the ways the second table checks.
This epic's own D3 was amended after merge three times, as [the binding section](#amendment-binding),
[the visibility section](#amendment-visibility) and [the hand-off section](#amendment-handoff) record.
Child-specific lineage belongs in each child's own evolution record.

## Predecessor designs

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A project is one row in the org `projects` collection; [`../FIX-1650/DECISIONS.md#d2`](../FIX-1650/DECISIONS.md#d2), ER-1 in [`../FIX-1650/BUSINESS-RULES.md`](../FIX-1650/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt) | **Amended**: a project is private (user scope) or shared (org scope), still one type, and its row holds no workstream data | The PRD: projects are private or shared | [ER-7](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1793 | None: rows stored before are dropped ([D9](DECISIONS.md#d9)) |
| A workstream is a declared channel (mailbox) and its boards; FIX-1650 ER-2; `workstream-claims/<mailboxId>` in `packages/workforce/src/projects/collections.ts` | **Superseded** | One owner per workstream; the row is the unit of ownership ([concept](concept/CONCEPT.md#how-a-workstream-is-stored)) | `workstreams/<project>/<owner>/<workstream>`, ER-7, FIX-1793 | FIX-1793 leaves the claims and the row's `workstreams` in place for FIX-1792's conversion, which removes them; their stored rows are dropped ([D9](DECISIONS.md#d9)) |
| A project's members talk in one room stored on it, each through their own talk session; [`../FIX-1650/DECISIONS.md#q1`](../FIX-1650/DECISIONS.md#q1), ER-25 to ER-28 | **Superseded** | Rooms are removed; a shared conversation between members waits for channels (the PRD) | The project coordinator, one per user per project, [ER-8](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1793 | Stored room lines are dropped ([D9](DECISIONS.md#d9)). FIX-1745 becomes obsolete |
| CoS is one org admin seat whose hires belong to the org; [`../FIX-1650/DECISIONS.md#q2`](../FIX-1650/DECISIONS.md#q2), ER-6 | **Superseded in part**: CoS is a standard coordinator at the top of each user's roster, and its hires are that user's | Workers are always private | ER-1, ER-4; FIX-1788, FIX-1791 | FIX-1719's shipped seat keeps working until FIX-1791 replaces it. ER-7's "the principal's own cell" is retained |
| Never call a seat a "worker" in a new product noun; FIX-1650 ER-13 | **Superseded** | "Worker" is the noun; "seat" is retired as a name for a worker (the PRD), and since 2026-10-07 on a task board too, where it becomes assignee ([D7](DECISIONS.md#d7)) | [ER-12](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1796 | FIX-1755 closes (the inventory) |
| Two follow-ups for Layer 1 names that carry seat words: rename the task envelope's `seat` (`TaskDispatchInput.seat`, the hand-off's `seat`) to `assignee`, and decide whether Layer 1 owns a closed list of discovery domains; [`../../issues/FIX-1575/DECISIONS.md#d2`](../../issues/FIX-1575/DECISIONS.md#d2), FIX-1575 PLAN → Follow-ups | **Adopted** for the rename, **open** for the list | The product owner (2026-10-07): a task board's seat becomes assignee, and "seat" is retired everywhere. That reverses their 2026-10-06 rule, which kept the board's `seat`. The `seats` domain lists Workforce workers, so it is renamed too | [D7](DECISIONS.md#d7): the envelope's and the hand-off's `seat` become `assignee`, with the board's types, and `MANIFEST_DOMAINS` says `workers`; FIX-1796 builds both. Whether Layer 1 keeps a closed list stays open, for [FIX-1803](https://linear.app/fixpoint-labs/issue/FIX-1803), FIX-1575's open question | Nothing reads the old field ([D9](DECISIONS.md#d9)). A caller passing `seats` gets the "unknown domain" listing (D7) |
| No session shared between users; access from the engine-recorded owner, never session state; FIX-1650 ER-21, ER-23 | **Retained** | Still true; the FIX-1729 spike's evidence holds | [ER-17, ER-18](BUSINESS-RULES.md#what-no-child-may-do) | None |
| INST-5, Workforce hires as instances of a collection kind with minted ids and owner pins; FIX-1320's Linear document, "Later / not Proof" item 5; shipped as FIX-1325 | **Superseded** | A hire becomes a write to a worker resource, run by the singleton flow it names; Workforce is the only user of collection kinds and pins | ER-1, FIX-1788 | Instances and pins stay in the engine untouched until FIX-1798 deletes them ([D9](DECISIONS.md#d9), [ER-20](BUSINESS-RULES.md#what-no-child-may-do)); FIX-1798 removes them later. Stored roster rows and hires are dropped, with no upgrade step ([D9](DECISIONS.md#d9)) |
| The six-key admission contract, `workerConfigSchema()`; FIX-1367, `packages/workforce/src/worker-config.ts` header | **Retained**, extended and amended | The contract is the base of the worker contract (the Architect's lock). Its keys stay; how they arrive changes, because a singleton holds one `ctx.flow.config` for every worker | ER-2, ER-14, FIX-1789 | The keys are additive. The configuration becomes stored data read per run, and `seatTools`' live blocks become names the installation resolves. "Kind-owned params" becomes flow-owned in wording only |
| Channel kinds at `workforce/flows/channels/<kind>.ts`, `CHANNEL.md` selecting one by `flow:`; FIX-1476 | **Superseded**, before this epic | FIX-1748 renamed channels to mailboxes. On `main` no `flows/channels/` path is tracked, and `packages/workforce/src/mailbox/pre-rename.ts` refuses `CHANNEL.md` and that folder by name | The coordinator that replaces the mailbox, [ER-6](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt); channels as a later feature, [ER-21](BUSINESS-RULES.md#what-no-child-may-do) | The pre-mailbox refusal goes with the mailbox code ([D9](DECISIONS.md#d9)); nothing here renames a channel |
| Projects stay org-level; no user-scope backing or personal project type; FIX-1763's description, "Projects stay org-level" and its fence list | **Amended** (Jake, 2026-10-06, [Q2](DECISIONS.md#q2)) | FIX-1763 left "dual org/user later via a create-time flag, no second project type" | ER-7 | FIX-1762's stack merged first; its locks carry into FIX-1793. FIX-1763 carries a note pointing at Q2 |
| One worker file on a team is the worker for that org, a second copy is a clone, model variants are separate files sharing core instructions; Jake, 2026-10-04, quoted in FIX-1786's Architect guidance | **Superseded** on ownership, **retained** for variants | This epic is newer: workers are private, standard ones are read-only projections | ER-1, FIX-1788, FIX-1795 | None; nothing shipped on the clone rule |

<a name="where-todays-code-differs-checked-against-main"></a>
## Where today's code differs, checked against `main`

The concept's table, re-read against `main` at `74f9a4f68`. Two facts are stated precisely
because the Architect named them.

| Today, and where | Treatment | Replacement |
|---|---|---|
| **A project room is a members' conversation on the mailbox flow**: `join`, `post`, `read` and `answer` entries on every mailbox kind, through each member's talk session; stored in `room-lines`, `room-seq`, `room-answers` and `room-deliveries` (`packages/workforce/src/projects/talk.ts`, `collections.ts`). It is not a passive shared record | **Removed** | The project coordinator session, FIX-1793 |
| **Runtime mailbox boards are org-scoped task ledgers**: one per declared board, minted `<mailboxId>.<board>` (usually `<mailboxId>.tasks`), scope hardcoded to `org` in `mailboxBoardLedger` and read together through `mailboxTaskLists` (`packages/workforce/src/mailbox/mailbox-board.ts`). The session's `userId` doesn't narrow them | **Superseded** | Session boards or workstreams, FIX-1792 and FIX-1794 ([D5](DECISIONS.md#d5)) |
| User data sits in the person's cross-org cell, except an owner-pinned instance's, keyed `<user>:~org:<org>` (`sharedUserKey` in `packages/engine/src/stores/scope-keys.ts`) | **Amended** | Per (user, org) for every flow, FIX-1790. Old records are dropped ([D9](DECISIONS.md#d9)); none falls back to the cross-org cell (ER-3) |
| A worker names its flow, and each hire mints its own copy of that flow, registered under the worker's id (`HireOptions.kinds`, `hire.ts`). The `agent` flow does it as one kind with many instances (`cardinality: "collection"`, `agent-worker-flow.ts`), each with an owner pin. Its per-worker skills drawer is `flowIsolation: true`, so each worker's cell is keyed by its instance id | **Superseded** | Every worker flow a worker can name becomes one singleton copy; workers that name `agent` become worker resources on its one copy, FIX-1788. On a singleton those cells would be one per user ([the POC](poc/singleton-worker-link/README.md), I1–I2), so FIX-1788 keys them by worker; today's per-worker cells are dropped ([D9](DECISIONS.md#d9)) |
| A worker's own post wakes nobody (`seatAuthored`, `mailbox/wake-member-seats.ts`) | **Amended** | Bounded rounds, ER-5, FIX-1791 |
| The hired roster is `defineHiredRosterCollection` under `workforce/roster/*` | **Superseded** | The user's worker resources, FIX-1788 |
| A fixed turn window, `historyWindow` (`packages/core/src/types/flow.ts`) | **Untouched here** | FIX-1775 |
| 33 `MAILBOX.md` files, 15 with `boards:`, 3 with `boardActions:` | **Converted** | FIX-1792. The concept's 32 and 14 predate a FIX-1778 goal fixture |

Neither predecessor epic is wholly superseded. FIX-1650's children land first, as the
inventory found. Re-check each cited intent against current code before implementing.

<a name="amendment-binding"></a>
## Amended after merge: a session's worker is a readonly field of its starting state (2026-10-07)

**The problem.** [D3](DECISIONS.md#d3)'s third change said a session's worker sat in a
server-only field on the session record, beside its state, set and checked when the session is
created. FIX-1788's P1 ([#2850](https://github.com/fixpoint-labs/flow-state-dev/pull/2850))
built something else: the worker is a readonly field of the session's starting state. The caller
sets it with `createSession({ state })`, the flow's optional create check confirms it, the engine
refuses any later change to it, and sessions can be listed by it. The product owner approved that
on 2026-10-07 and rejected a separate link concept. FIX-1788's own amendment
([#2857](https://github.com/fixpoint-labs/flow-state-dev/pull/2857)) records it as its D5, with
the issue-level detail in [its evolution record](../../issues/FIX-1788/EVOLUTION.md#amendment-binding).
This section covers what spans the set. Original epic review:
[#2795](https://github.com/fixpoint-labs/flow-state-dev/pull/2795).

| What | Treatment | Why | What is retained |
|---|---|---|---|
| [D3](DECISIONS.md#d3) *Locks in* (3): "session data only the server writes", held in "a server-only field on the session record, set and checked when the session is created" | **Superseded** by what shipped | The product owner rejected a separate link. A readonly field, the create check and the listing filter answer each reason the field was kept out of state: it was writable, set by the caller unchecked, and not listable | Named at create, never on a turn; a session's worker never changes; no action names a worker; a coordinator's delegates are server-owned; FIX-1788 builds it, FIX-1791 consumes it |
| D3 *Because*: "session state a caller can't write", and the POC's "a link held there accepts the caller's own other worker" | **Amended** | The caller does write the worker, once, at create. What the POC found was a value stored unchecked, and stored as sent when the schema refused it | The POC's findings (its O1 and R1 legs): plain, unchecked state and a row only flow code writes still don't hold ER-1 |
| [ER-1](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt): "no caller and no action names a worker", "a forged link reads nothing" | **Amended** | The caller names the worker when creating the session. A forged value is answered by the create check, which accepts only the caller's own workers or a standard one, and a readonly value can't change after | A session's worker never changes; no action or message names one |
| [ER-17](BUSINESS-RULES.md#what-no-child-may-do): "a worker link" among the fields that grant nothing | **Amended** in wording | One name per thing | The rule: access is the engine-recorded owner, checked against the resource. The session's worker passes that check once, in the create check |
| The set table's FIX-1788 row, the plan's FIX-1788 row and its "session data only the server writes" seam, the end-state POC record, and the concept's session paragraph, forged-link note and security rule 4 | **Amended** in wording | Each described the link | Ownership: FIX-1788 lands it, FIX-1791 consumes it. The POC's findings stand as run |
| The *How it got here* entries for the POC, review round 2 and FIX-1789's gate | **Kept as written** | They record what was decided then | A new *How it got here* entry |

No stored data changes: the server-only field never shipped.

### The three engine changes, and D3's count of six

P1 shipped three engine changes that item (3) didn't name as first written:

- **A readonly guard on session state.** A top-level `.readonly()` field of a flow's session
  `stateSchema` is refused on any change after create, on every path that writes session state.
- **A state filter on listing, inside the store.** `listSessions({ state })` filters on readonly
  fields only, in each store's own query.
- **A schema refusal at create, on flows that bind their sessions.** A flow with a readonly field
  or a create check refuses a starting state its schema rejects. Other flows keep today's create.

**D3 still counts six mechanism changes.** D3 counts what Workforce cannot fake, and the three
build the third of them, session state a caller can't change after create. Each answers one
reason item (3) existed: the guard makes the worker fixed, the schema refusal lets the create
check see the state the session keeps, and the filter replaces the listing the server-only field
would have needed. None names a worker, so D3's call, no worker noun in Layer 1, stands. Item (3)
is restated to name them, so [ER-22](BUSINESS-RULES.md#what-no-child-may-do) is not tripped going
forward.

**The honest part.** Item (3) as written named one field, and P1 merged three general engine
changes before this epic recorded them. ER-22 asks for an escalation before such a change; this
one came after, as the product owner's approval on 2026-10-07. Widening the schema refusal to every
flow, FIX-1788's follow-up once FIX-1792 removes the mailbox, is the same refusal reaching further,
not a seventh change. Any other engine change on this path comes back to this epic first.

<a name="amendment-visibility"></a>
## Amended after merge: one view of a shared copy's resources per turn (2026-10-07)

**The problem.** After FIX-1788's P4, every worker runs on one shared copy of the flow it names
(its S10). That copy has to declare every document any worker on it might be granted. Core's
document tools (list, read, write, search, and the path lookup in
`packages/core/src/tools/resource-tools.ts`) enumerate the copy's whole resource registry, and
nothing in core lets a turn narrow it. Under a copy per worker, each copy held only that worker's
granted documents, so a grant held for every tool, an app's own included. FIX-1788's S8 stopped
at its guardrail ("if S8 needs one, stop and take it to the epic"), and the product owner chose
option A on 2026-10-07. FIX-1788 records it as its [D7](../../issues/FIX-1788/DECISIONS.md#d7),
with the issue-level detail in [its evolution record](../../issues/FIX-1788/EVOLUTION.md#amendment-visibility).
Original epic review: [#2795](https://github.com/fixpoint-labs/flow-state-dev/pull/2795).

| What | Treatment | Why | What is retained |
|---|---|---|---|
| [D3](DECISIONS.md#d3): six mechanism changes, in its title, *Because* and *Locks in* | **Amended** to seven. *Because* gains the seventh thing Workforce cannot fake, one view of a shared copy's resources per turn; *Locks in* gains item (7) | A Workforce-only check leaves core's own tools seeing every document on the copy. A rule core honours is the one place every model-facing path passes | D3's call: no worker noun in Layer 1, and the rule names no worker. "Any other Layer 1 change comes back to this epic" stands |
| The count elsewhere: [D1](DECISIONS.md#d1)'s *Locks in* and its figure, the tree, the box's text and figure, [ER-22](BUSINESS-RULES.md#what-no-child-may-do), the set table's and the plan's FIX-1788 rows, and the concept's cost of declaring resources on flows | **Amended** to seven, or to name the rule | One count across the set. ER-22 is what a child checks before a Layer 1 change | The two public renames and the one public removal |
| The binding section's "not a seventh change", above | **Kept as written** | It records the count that day. Widening FIX-1788's schema refusal to every flow is still the third change reaching further, not an eighth | The section as merged |
| The *How it got here* entries that count six | **Kept as written** | They record what was decided then | A new *How it got here* entry |

**The rule, as the product owner approved it.** Optional, per turn and generic: it names no
worker. Every model-facing listing and lookup in core honours it, and a hidden resource answers
exactly as a missing one does. With no rule, everything is visible, as before. Workforce supplies
it from the worker verified on the turn. It governs what the model reaches through tools and
context; it does not filter app code that reads a resource directly by reference. That code is
its author's, as FIX-1788's D6 has it for a custom worker flow. FIX-1788's P4 builds it, and the
option's name is FIX-1788's.

**Rejected.** B, Workforce-only document tools that check grants: an app tool or capability
built on core's document tools would still see every document on the copy, a silent breach no
test catches. C, a copy per worker for workers holding grants: it contradicts FIX-1788's S10, one
copy per flow, and keeps the per-worker minting P4 removes.

**A section of its own, not an extension of the binding section.** That section recorded engine
changes that build D3's third mechanism and kept the count at six. This one adds a mechanism and
moves the count, with its own alternatives. Folding it in would blur which amendment changed
what. No stored data changes.

<a name="amendment-handoff"></a>
## Amended after merge: one word per thing for hand-offs; skill sub-agents removed (2026-10-08)

**The problem.** A skill that lists sub-agents under `agents:` makes the skills library build a
private task board inside the request, with its own copy of the eight task tools and `runBoard`.
FIX-1794's P2 puts the same eight on the coordinator, which since FIX-1791 runs the built-in
agent's shared worker turn, and FIX-1802's S1 puts them on `agent`. A worker holding such a skill
and a task-taking delegate would carry two tools of each name, and core refuses that on every
turn. The product owner decided on 2026-10-08 to remove sub-agents rather than guard around them,
and to give hand-offs one word per thing. The epic records it as [D10](DECISIONS.md#d10);
[FIX-1814](https://linear.app/fixpoint-labs/issue/FIX-1814), which has no spec, does the removal.
Original epic review: [#2795](https://github.com/fixpoint-labs/flow-state-dev/pull/2795).

**The predecessor it supersedes.** No retained spec exists for it, so the sources are the
Linear issues and the shipped files.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Skill sub-agents: a skill's `agents:` key installs a delegation surface, a private board with the eight task tools and `runBoard` ([FIX-918](https://linear.app/fixpoint-labs/issue/FIX-918)); a task assigned straight to a tool the skill allows ([FIX-925](https://linear.app/fixpoint-labs/issue/FIX-925)); an on-demand default worker, the floor ([FIX-940](https://linear.app/fixpoint-labs/issue/FIX-940)). `packages/orchestration/src/skills/delegation-surface.ts` header, `apps/docs/docs/skills/delegation.md` | **Superseded**: removed by FIX-1814 | The product owner, 2026-10-08: half-baked (is it an agent or one generator loop, does it have memory, why is there no agent concept), and its second set of task tools fails a delegating worker's turn | Delegation on the conversation's board (FIX-1794, FIX-1802). A skill's private team is rethought in the follow-up epic, [FIX-1815](https://linear.app/fixpoint-labs/issue/FIX-1815) ([FIX-1819](https://linear.app/fixpoint-labs/issue/FIX-1819)) | A `SKILL.md` that still declares `agents:` is refused loudly, saying sub-agents were removed: [ER-31](BUSINESS-RULES.md#what-no-child-may-do)'s one exception. The task board, its eight task tools and its hand-off are untouched |

**What changed in this set.**

| What | Treatment | Why | What is retained |
|---|---|---|---|
| [D3](DECISIONS.md#d3): "seven mechanisms, two renames and a removal", in its title, *Because* and *Locks in* | **Amended** to two public removals; *Locks in* names FIX-1814's | A published orchestration surface leaves, so ER-22 counts it | Seven mechanism changes. The kill line is untouched: it is about a worker's own state |
| The count elsewhere: D1's *Locks in* and its figure, the tree, D7's *Locks in*, the box's text and figure, [ER-22](BUSINESS-RULES.md#what-no-child-may-do), the plan's FIX-1792 row | **Amended** to two removals | One count across the set | The two public renames |
| [ER-31](BUSINESS-RULES.md#what-no-child-may-do) and [D9](DECISIONS.md#d9)'s *Not reached*: no refusal of an old shape by name | **Amended** with one exception, the loud refusal of `agents:` | The product owner's later, more specific call, which wins as D9 won over BP-030 | Every other refusal by name stays out |
| A second set of task tools on a turn: unstated | **Added** as [ER-32](BUSINESS-RULES.md#what-no-child-may-do), with a must-test in FIX-1794's V3 and FIX-1802's V1 | Asked for by the engineering lead and the cycle PM | — |
| [D8](DECISIONS.md#d8)'s "the board's eight tools a skill's delegation surface installs today" | **Amended** in wording | The surface goes | The grant and the tools |
| The concept's vocabulary: a delegate as "a worker a coordinator can hand posts to"; "mailbox" retired | **Amended**: hand-off, ask, assign and delegation added; a delegate is a worker a conversation may delegate to; "mailbox" retired and kept back for a future untrusted inbox. [ER-12](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt) keeps "delegation" to Workforce's meaning in published pages | One word per thing | Every other term |
| The set table, the graph, the path, the plan and DOCS's ownership | **Amended**: FIX-1814 joins, blocking FIX-1794's P2, FIX-1802 and the closure; FIX-1802's page is "Delegating work"; FIX-1815 named as the follow-up epic | D10, ER-27 | — |
| The *How it got here* entries and the earlier amendment sections that count one removal | **Kept as written** | They record what was decided then | A new *How it got here* entry |

FIX-1802, FIX-1794 and FIX-1796 carry their own entries for this amendment. FIX-1791 and
FIX-1792 state nothing it makes false, so they are unchanged. No stored data changes.
