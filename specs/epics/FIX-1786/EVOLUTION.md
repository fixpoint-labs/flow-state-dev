# FIX-1786 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Lineage that spans more than one child. Two predecessor epics are superseded in part, one
lock is amended, and today's code differs from the target in the ways the second table checks.
Child-specific lineage belongs in each child's own evolution record.

## Predecessor designs

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A project is one row in the org `projects` collection; [`../FIX-1650/DECISIONS.md#d2`](../FIX-1650/DECISIONS.md#d2), ER-1 in [`../FIX-1650/BUSINESS-RULES.md`](../FIX-1650/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt) | **Amended**: a project is private (user scope) or shared (org scope), still one type, and its row holds no workstream data | The PRD: projects are private or shared | [ER-7](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1793 | Existing org rows read as shared projects (BP-030) |
| A workstream is a declared channel (mailbox) and its boards; FIX-1650 ER-2; `workstream-claims/<mailboxId>` in `packages/workforce/src/projects/collections.ts` | **Superseded** | One owner per workstream; the row is the unit of ownership ([concept](concept/CONCEPT.md#how-a-workstream-is-stored)) | `workstreams/<project>/<workstream>`, ER-7, FIX-1793 | FIX-1793's spec moves or dual-reads the claims and the row's `workstreams`; nothing is dropped silently |
| A project's members talk in one room stored on it, each through their own talk session; [`../FIX-1650/DECISIONS.md#q1`](../FIX-1650/DECISIONS.md#q1), ER-25 to ER-28 | **Superseded** | Rooms are removed; a shared conversation between members waits for channels (the PRD) | The project coordinator, one per user per project, [ER-8](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1793 | FIX-1793's spec decides whether stored room lines stay readable; none is deleted silently. FIX-1745 becomes obsolete |
| CoS is one org admin seat whose hires belong to the org; [`../FIX-1650/DECISIONS.md#q2`](../FIX-1650/DECISIONS.md#q2), ER-6 | **Superseded in part**: CoS is a standard coordinator at the top of each user's roster, and its hires are that user's | Workers are always private | ER-1, ER-4; FIX-1788, FIX-1791 | FIX-1719's shipped seat keeps working until FIX-1791 replaces it. ER-7's "the principal's own cell" is retained |
| Never call a seat a "worker" in a new product noun; FIX-1650 ER-13 | **Superseded** | "Worker" is the noun; "seat" is retired (the PRD) | [ER-12](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1796 | FIX-1755 closes (the inventory) |
| No session shared between users; access from the engine-recorded owner, never session state; FIX-1650 ER-21, ER-23 | **Retained** | Still true; the FIX-1729 spike's evidence holds | [ER-17, ER-18](BUSINESS-RULES.md#what-no-child-may-do) | None |
| INST-5, Workforce hires as instances of a collection kind with minted ids and owner pins; FIX-1320's Linear document, "Later / not Proof" item 5; shipped as FIX-1325 | **Superseded** | A hire becomes a write to a worker resource on a singleton flow; Workforce is the only user of collection kinds and pins | ER-1, FIX-1788 | Instances and pins stay in the engine, deprecated ([ER-20](BUSINESS-RULES.md#what-no-child-may-do)). Stored roster rows read into worker resources (BP-030) |
| The six-key admission contract, `workerConfigSchema()`; FIX-1367, `packages/workforce/src/worker-config.ts` header | **Retained**, extended | The contract is the base of the worker contract (the Architect's lock) | ER-2, ER-14, FIX-1789 | Additive. "Kind-owned params" becomes flow-owned in wording only |
| Channel kinds at `workforce/flows/channels/<kind>.ts`, `CHANNEL.md` selecting one by `flow:`; FIX-1476 | **Retained**, untouched | Channels are out of scope | ER-20 | None |
| Projects stay org-level; no user-scope backing or personal project type; FIX-1763's description, "Projects stay org-level" and its fence list | **Amended if Jake agrees** ([Q2](DECISIONS.md#q2)) | FIX-1763 left "dual org/user later via a create-time flag, no second project type" | ER-7 | FIX-1762's locks carry into FIX-1793. FIX-1763's vocabulary block gets a note once confirmed |
| One worker file on a team is the worker for that org, a second copy is a clone, model variants are separate files sharing core instructions; Jake, 2026-10-04, quoted in FIX-1786's Architect guidance | **Superseded** on ownership, **retained** for variants | This epic is newer: workers are private, standard ones are read-only projections | ER-1, FIX-1788, FIX-1795 | None; nothing shipped on the clone rule |

<a name="where-todays-code-differs-checked-against-main"></a>
## Where today's code differs, checked against `main`

The concept's table, re-read against `main` at `74f9a4f68`. Two facts are stated precisely
because the Architect named them.

| Today, and where | Treatment | Replacement |
|---|---|---|
| **A project room is a members' conversation on the mailbox flow**: `join`, `post`, `read` and `answer` entries on every mailbox kind, through each member's talk session; stored in `room-lines`, `room-seq`, `room-answers` and `room-deliveries` (`packages/workforce/src/projects/talk.ts`, `collections.ts`). It is not a passive shared record | **Removed** | The project coordinator session, FIX-1793 |
| **Runtime mailbox boards are org-scoped task ledgers**: one per declared board, minted `<mailboxId>.<board>` (usually `<mailboxId>.tasks`), scope hardcoded to `org` in `mailboxBoardLedger` and read together through `mailboxTaskLists` (`packages/workforce/src/mailbox/mailbox-board.ts`). The session's `userId` doesn't narrow them | **Superseded** | Session boards or workstreams, FIX-1792 and FIX-1794 ([D5](DECISIONS.md#d5)) |
| User data sits in the person's cross-org cell, except an owner-pinned instance's, keyed `<user>:~org:<org>` (`sharedUserKey` in `packages/engine/src/stores/scope-keys.ts`) | **Amended** | Per (user, org) for every flow, FIX-1790. Old records move to one org by an operator step or stop with `migration-required`, as the owner-pinned cell's do; none falls back to the cross-org cell (ER-3) |
| The `agent` flow is the one flow with many instances (`cardinality: "collection"`, `agent-worker-flow.ts`), each with an owner pin. Its per-seat skills drawer is `flowIsolation: true`, so each seat's cell is keyed by its instance id | **Superseded** | Worker resources on one `agent` flow, FIX-1788. On a singleton those cells would be one per user ([the POC](poc/singleton-worker-link/README.md), I1–I2), so FIX-1788 keys them by worker and moves the per-seat cells |
| A worker's own post wakes nobody (`seatAuthored`, `mailbox/wake-member-seats.ts`) | **Amended** | Bounded rounds, ER-5, FIX-1791 |
| The hired roster is `defineHiredRosterCollection` under `workforce/roster/*` | **Superseded** | The user's worker resources, FIX-1788 |
| A fixed turn window, `historyWindow` (`packages/core/src/types/flow.ts`) | **Untouched here** | FIX-1775 |
| 33 `MAILBOX.md` files, 15 with `boards:`, 3 with `boardActions:` | **Converted** | FIX-1792. The concept's 32 and 14 predate a FIX-1778 goal fixture |

Neither predecessor epic is wholly superseded. FIX-1650's children land first, as the
inventory found. Re-check each cited intent against current code before implementing.
