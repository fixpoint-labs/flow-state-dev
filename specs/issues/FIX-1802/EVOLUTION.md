# FIX-1802 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1794's split: [S8](../FIX-1794/PLAN.md#surfaces), [S10](../FIX-1794/PLAN.md#surfaces), [BR-7, BR-30 to BR-32](../FIX-1794/BUSINESS-RULES.md#the-chain), [V6](../FIX-1794/PLAN.md#checks), goal leg b, carried here by its [Q](../FIX-1794/DECISIONS.md#q) | **Retained** as written, with both review fixes: the server-written parent binding (round 1) and the settle-owed marker (round 2, [#2828](https://github.com/fixpoint-labs/flow-state-dev/pull/2828)) | The POC shows today's board settles a parked row in a later request through a stored ticket (P2, P3) | S4, BR-14 to BR-18, V3; goal leg a | Nothing shipped from it |
| FIX-1794's [D2](../FIX-1794/DECISIONS.md#d2): five boards deep, and each board's own caps as the breadth bound | Depth **retained**; breadth **amended**: a count of 50 per chain is added beside the board caps | FIX-1794's own review asked for a fan-out bound; per-board caps allow 11,110 tasks under one top task at ten a board | [D2](DECISIONS.md#d2), BR-20 to BR-22 | The board caps stay as FIX-1794 sets them |
| FIX-1794 *decided, not asked*: "a worker that splits its task is a coordinator"; [S4](../FIX-1794/PLAN.md#surfaces): filing on coordinator conversations, a task session refused | **Superseded** | The product owner, 2026-10-06 ([epic D8](../../epics/FIX-1786/DECISIONS.md#d8)) | [D1](DECISIONS.md#d1); S1, S2, S6 remove the interim answer | FIX-1794 ships the interim; this issue replaces it before the MVP. The chief of staff's file gains `filing: true` (S7) |
| FIX-1791's delegates as the coordinator's: the `delegates` key ([S1](../FIX-1791/PLAN.md#surfaces)), [BR-1a](../FIX-1791/BUSINESS-RULES.md#delegates) (actions only on a coordinator), [BR-4](../FIX-1791/BUSINESS-RULES.md#delegates) (a delegate's flow must take a post) | The records, the copy on first read and the one check **retained**; BR-1a and BR-4 **amended** | One list for who works for a worker (D1); the EM's `coder` takes tasks, not posts | S2, S3; BR-7, BR-9 | A coordinator's file and its delegates read as before |
| The epic's [D2](../../epics/FIX-1786/DECISIONS.md#d2): "a board is session state any worker flow may keep" | **Retained**, and now the rule: the board is the granted worker's session's | — | BR-11 | n/a |

The epic's D8 is this issue's charter, not a predecessor. FIX-1794's merged spec carries a matching
post-merge note in its [EVOLUTION.md](../FIX-1794/EVOLUTION.md), amended on this spec's PR. Before
implementation, compare these intents with `main`: none of FIX-1788, FIX-1791 or FIX-1794 has
shipped as this is written.
