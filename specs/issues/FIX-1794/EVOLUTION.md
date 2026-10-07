# FIX-1794 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1777: filing is the hand-off; the list runs as the filer; one filer's run claims only its own; who gets an unassigned task. Spec PR [#2753](https://github.com/fixpoint-labs/flow-state-dev/pull/2753), closed unmerged; last head [`16fcb94`, `specs/issues/FIX-1777/BUSINESS-RULES.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/16fcb941fc0989be8c5b4a10f055a2338e0286d4/specs/issues/FIX-1777/BUSINESS-RULES.md) BR-1 to BR-19 | **Retained** for the start on add, the filing returning first, the unassigned rule and the refusals; **superseded** for the mailbox list, `workedBy:`, `taskListWorkers` and the owner stamped on the row | Jake closed FIX-1777 into this issue (epic Q3). On a board kept per conversation, the owner is the scope holding the row, and the workers are the conversation's delegates | BR-1, BR-5, BR-6, BR-9, BR-10; [D1](DECISIONS.md#d1) | Nothing shipped from it |
| FIX-1780: the notice lands in the conversation it was filed from ([D1](../FIX-1780/DECISIONS.md#d1)); three endings wake it ([D3](../FIX-1780/DECISIONS.md#d3)); reassign and cancel ([BR-16 to BR-22](../FIX-1780/BUSINESS-RULES.md#reassign-and-cancel)) | **Retained** for the notices; its filer record (`filingSession`, `filingWorker`, [Who is a filer](../FIX-1780/BUSINESS-RULES.md#who-is-a-filer)) and its reassign and cancel rules **superseded** | The board's conversation is the filer by construction, and the engine's stamped sender reaches it across a flow ([POC](poc/board-partition/README.md) F1). Only S5a shipped (#2761); the rest was carried to FIX-1791, then here (FIX-1791 Q1) | BR-22 to BR-29. Its reassign and cancel rules are superseded by the task tools' own (*amended after merge*, below) | S5a's assignee freeze holds unchanged on this board |
| FIX-1778: an assignee names a worker, resolved at hand-over through a generic hook Workforce fills ([D1](../FIX-1778/DECISIONS.md#d1)); a worker takes tasks from any list that names it ([D3](../FIX-1778/DECISIONS.md#d3)) | D1 **amended**: the name still resolves to a flow, but only after FIX-1791's delegate check passes. D3 **superseded** on conversation boards | A lookup answers "is this a valid name", never "is it yours" (FIX-1791 decided, not asked) | BR-2, BR-3; S3, S4 | Mailbox lists keep D3 until FIX-1792 |
| FIX-1774 leg e: a task fails and the coordinator reassigns or cancels it. Spec PR [#2747](https://github.com/fixpoint-labs/flow-state-dev/pull/2747), closed; [`a8e45d6`, `specs/issues/FIX-1774/SPEC.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/a8e45d681a192ac9ca686216e41088a6e5352a49/specs/issues/FIX-1774/SPEC.md) | **Retained** | Carried through FIX-1791's Q1 | Goal leg e | n/a |
| This issue's PRD: boards below a workstream are session-scoped and shared down their lineage ([Linear](https://linear.app/fixpoint-labs/issue/FIX-1794), Outcome, third point) | **Amended**: the intent (a task session settles its row on the board that filed it) kept, the storage changed | A lineage stops at a flow ([epic POC](../../epics/FIX-1786/poc/singleton-worker-link/README.md) C1), and the epic left how to this issue ([ER-9](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | [D1](DECISIONS.md#d1) | `sharedToLineage` boards are unchanged; the chain doesn't use them |

Amended after merge (FIX-1802's spec PR): epic [D8](../../epics/FIX-1786/DECISIONS.md#d8) (the product owner, 2026-10-06) reversed
[Q](DECISIONS.md#q)'s answer. The split ships in the MVP as [FIX-1802](../FIX-1802/SPEC.md), which
builds right after this issue, and filing is a tool any worker can be granted, not what makes a
coordinator. Since no implementation had started, this issue ships the final shape: a board per
session (S3), worked through Orchestration's existing eight task tools (S4). Its one interim part
is the answer to "may this session file": a coordinator conversation, and never a task session
(BR-7), until FIX-1802's delegate rule replaces it. The split's acceptance (leg b, BR-30 to BR-32,
S8, S10, V6) is pointer-only, owned by FIX-1802. Also updated: the people table, the sign-off, Q,
*decided, not asked*, the follow-ups and the docs draft.

The product owner's sign-off on FIX-1802 (2026-10-07) folds in on the same PR. The four filing
verbs this spec named (`fileTask`, `reassignTask`, `cancelTask`, `listTasks`) are superseded by
the task tools' existing eight; never shipped. FIX-1780's `reassignTask` rules, cited by S4
(its BR-16 to BR-22), are superseded by those tools' own contract on this board (*decided, not
asked*). The tools gain one extension, T1, a roster read per call and on `taskToolActions`: a
Layer 1 change the epic records (ER-22). The task session's lookup key is `filingSessionId`,
renamed from `coordinatorSessionId`; never shipped. No backwards support is added for any of
these: nothing shipped and there are no consumers.

`sharedToLineage` itself (FIX-1068, and [FIX-1084](../FIX-1084/SPEC.md)'s routing rule) is a
neighbour, not a predecessor: it keeps working as shipped. The epic's [D5](../../epics/FIX-1786/DECISIONS.md#d5)
and ER-9 are answered here, not superseded. Before implementation, compare these intents with
`main`: only FIX-1780's S5a and FIX-1778's hook shipped.

<a name="amendment-cross-spec"></a>
## Amended after merge (cross-spec alignment, 2026-10-07)

**The alignment.** Reading the epic's merged child specs against each other found places where
siblings read two ways. Each was an engineering call, made under decisions already taken, and
recorded in the epic's [How it got here](../../epics/FIX-1786/DECISIONS.md#how-it-got-here). This
spec changed:

| What | Treatment | Why | What is retained |
|---|---|---|---|
| *Decided, not asked*, BR's "Reassign and cancel" and this record's FIX-1780 row: FIX-1780's BR-16 to BR-22 apply | **Amended** to the task tools' own contract, as the amended *decided, not asked* line already said | A cancel of a running task lands and cascades (FIX-1802 BR-19); its late result is declined; no three-move limit | The assignee freeze; BR-2's check on a reassign |
| T1: outside the epic's "D3 four" | **Amended**: the fifth of D3's six | The epic's count moved | T1 as written |
| The incarnation line's BP-030 citation | **Amended**: it gives its own reason | Epic D9: BP-030 doesn't apply to this epic | Old rows stay unread |
