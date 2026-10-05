# FIX-1779 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Earlier designs said mailboxes (then channels) change only through files. This set is the
ship ticket FIX-1415 said would have to come. It retains most of that design and moves two
fences.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1415 D1: a room opened at run time is found the same way as a declared one; the inventory row is still required. [`../FIX-1415/DECISIONS.md#d1`](../FIX-1415/DECISIONS.md#d1) | **Retained** | Its POC showed `discover` hides an inventory-only room. That is still true on `main` | S7: `discover` lists rows marked `origin: "runtime"`; BR-19 | Declared rows keep today's join |
| FIX-1415 fences: a capability plus named `tools:`, not a type; open a session on the existing kind; don't bolt verbs onto the declaration binder. [`../FIX-1415/DECISIONS.md`](../FIX-1415/DECISIONS.md) → "Fences, not asked" | **Retained** | Unchanged by anything since | S10, S5 (a run-time opener beside the binder, not inside it) | — |
| FIX-1415 fence: a declared room is not re-membered by a tool. Same section | **Superseded** | The binder already treats the file as a starting list: an edit never reaches an open mailbox. Jake (2026-10-04) made getting workers to the right place the coordinator's job | [D2](DECISIONS.md#d2) | Undeletable still holds: there is no delete |
| FIX-1415 leans: verbs create / delete / invite / uninvite; one grant; no TTL; ship waits on Collab's mint. [`../FIX-1415/DECISIONS.md#recommended-still-open`](../FIX-1415/DECISIONS.md#recommended-still-open) | **Amended** | The verbs become set up / subscribe / unsubscribe / file a task; delete stays out. One grant and no TTL are retained. Waiting on Collab ([FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341)) is superseded: this is the "minimal list inside Workforce" case it named, built on the session and inventory, not a second store | [D1](DECISIONS.md#d1), S10 | — |
| FIX-1650 D3 (amended) and ER-3: the one run-time move is minting a talk session from a template; nobody opens, invites to or renames a channel at run time. [`../../epics/FIX-1650/DECISIONS.md#d3`](../../epics/FIX-1650/DECISIONS.md#d3), [`../../epics/FIX-1650/BUSINESS-RULES.md#what-no-child-may-do`](../../epics/FIX-1650/BUSINESS-RULES.md#what-no-child-may-do) | **Amended** for mailboxes; retained for project rooms | That epic's set is complete. Its talk-template mint is untouched here | D1, D2 | Project rooms unchanged |
| FIX-1455 ER-16: no run-time channel-admin verbs in that set. [`../../epics/FIX-1455/BUSINESS-RULES.md`](../../epics/FIX-1455/BUSINESS-RULES.md), [answered](../../epics/FIX-1455/DECISIONS.md#answered-runtime-admin) | **Moved past**; scoped to that set | It named FIX-1415 as the owner | This set | — |
| FIX-1476 guardrail: no worker-facing create, delete, invite, join or leave. [`../FIX-1476/PLAN.md`](../FIX-1476/PLAN.md) → Guardrails | **Moved past**; scoped to that issue | Same reason as ER-16 | S10 | Still no client join or leave |
| FIX-1718 D1: a workstream names a declared mailbox, checked against the inventory. [`../FIX-1718/DECISIONS.md#d1`](../FIX-1718/DECISIONS.md#d1) | **Amended**: "declared" widens to "has an inventory row" | The check already reads only the inventory | BR-20 | Unchanged for file mailboxes |
| FIX-1748 D3: a workstream is a mailbox plus its boards; a board sits beside the mailbox. [`../FIX-1748/DECISIONS.md#d3`](../FIX-1748/DECISIONS.md#d3) | **Retained** | A run-time task list is still a ledger beside the mailbox, keyed by its id | S1, S2 | — |
| FIX-1480 (unmerged explore): hire does not attach boards; that is a later channel-admin act. [Linear FIX-1480](https://linear.app/fixpoint-labs/issue/FIX-1480), branch `cursor/fix-1480-explore-seat-hire-005b`, `DECISIONS.md#d1` | **Retained**; this is that act | Hire is unchanged | `subscribeWorkers` with `worksTaskList` | — |
| Mailboxes doc: "there is no join or leave verb yet", and a hire is not woken "until the app restarts". `apps/docs/docs/workforce/mailboxes.md` | **Superseded** | The restart claim was not true even after a restart: both hosts build the wake before reloading hires | [DOCS.md](DOCS.md), S8, S11 | A fixed list still works |

Before building, compare these against current code: FIX-1777 and FIX-1778 may have landed
pieces of S8 or S9.
