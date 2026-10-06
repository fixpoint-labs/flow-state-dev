# FIX-1792 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

The mailbox-file designs this issue removes or changes. The epic's lineage
([epic EVOLUTION](../../epics/FIX-1786/EVOLUTION.md)) covers the mailbox boards and claims at set
level; FIX-1791's covers routing and the wake. This is the file, the board and the refusal detail.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A mailbox is declared in `teams/<team>/mailboxes/<name>/MAILBOX.md`, its frontmatter carried verbatim; `packages/workforce/src/loader/read-mailboxes-directory.ts` header, and its closed key list in `mailbox-binder.ts` (`DECLARABLE_KEYS`) | **Superseded** | One way to declare a worker ([epic ER-6](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | A `WORKER.md` on the coordinator flow; BR-1, BR-7 | Old files refused by name, with the conversion; no loader reads them |
| A mailbox declares durable boards by name, each an org-scoped ledger minted `<id>.<board>`; FIX-1385 (no retained spec; [Linear](https://linear.app/fixpoint-labs/issue/FIX-1385)), `mailbox/mailbox-board.ts` | **Superseded** | The shape the epic removes ([epic D5](../../epics/FIX-1786/DECISIONS.md#d5)) | The conversation's board (FIX-1794) or a workstream (FIX-1793); [D1](DECISIONS.md#d1) | Rows left unread ([D2](DECISIONS.md#d2)) |
| `boardActions: true` exposes a mailbox board's task tools as mailbox actions; [FIX-1629 D1](../FIX-1629/DECISIONS.md#d1) | **Superseded in part** | A conversation has its filing actions always (FIX-1794) | FIX-1794's actions; the DevTool keeps changing a task through the flow's own actions, as D1 decided | The key refused by name on a `WORKER.md` |
| Kitchen-sink's specialists file a case onto the mailbox's own board through its `fileTask`; [FIX-1611 D2](../FIX-1611/DECISIONS.md#d2) | **Amended** | The board is the conversation's, and only its coordinator files on it ([FIX-1794](../FIX-1794/SPEC.md) S4) | The specialist's answer carries the case; the help coordinator files one unassigned row on its own conversation's board; BR-14 | None; kitchen-sink converts whole |
| Data and files from before the channel rename are refused by name, and in-repo labs reset their stores; [FIX-1748 D1](../FIX-1748/DECISIONS.md#d1) | **Retained** for channel names, **amended** in what it tells you, and **not followed** for mailbox data | The refusal still fits old names; a reset would cost every project for rows nobody can place | BR-6 points the channel refusal at `WORKER.md`; D2 leaves mailbox data unread rather than resetting | `PRE_RENAME_NAMES` stays until 1.0 |
| In Shift Manager a workstream stays a workstream and "mailbox" names its conversation; [FIX-1748 D3](../FIX-1748/DECISIONS.md#d3) | **Superseded** | A workstream is an entry and its lead's session (FIX-1793) | S7, S8 | None |
| A project lists its workstreams by mailbox id, and a claim holds each; [FIX-1718 D1](../FIX-1718/DECISIONS.md#d1), kept deprecated by [FIX-1793](../FIX-1793/DECISIONS.md#decided-not-asked) | **Removed** | The epic moved their removal here | Workstream entries; BR-16, BR-21 | Claim rows and lists left unread (BR-20) |
| A tree declares mailbox kinds in `flows/mailboxes/`, rendered as `mailboxKinds`; `CODE_SLOTS` in `packages/workforce/src/codegen/discover.ts` | **Superseded** | No mailbox kinds remain | `flows/workers/` and the worker-flow list ([FIX-1789](../FIX-1789/SPEC.md)) | The folder refused by name (BR-4) |
| The inventory keeps mailbox and membership rows; `inventory/collections.ts` header | **Removed** | Who a coordinator hands work to is its delegate read (FIX-1791) | None | Rows left unread (BR-22) |
| The epic's upgrade draft: "`routing:`, `flow:` unchanged"; [epic DOCS](../../epics/FIX-1786/DOCS.md#create--appsdocsdocsworkforceupgradingmd--from-mailboxmd-to-workermd), and the concept's table | **Amended** | FIX-1791 pinned routing values and reads a missing `routing:` as judgment; both `flow:` lines name a kind of a tree's own | [DOCS.md](DOCS.md)'s table | None; unpublished |

None of these is wholly gone until P4b. Re-check each against `main` before building: FIX-1791,
FIX-1793 and FIX-1794 change the parts this issue converts onto.
