# FIX-1592 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans more than one child. FIX-1585's own predecessors are in its evolution
record.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| `escalations` ships unattended so the boot warning is visible. Sources: [FIX-1476 D3](../../issues/FIX-1476/DECISIONS.md#d3), its BR-10, and the README section it published | **Superseded** | Owner call on 2026-09-25, keeping FIX-1591 ([D3](DECISIONS.md#d3)) | D3 · ER-14 · ER-19, built by FIX-1591 | Leg V9 of `a-channel-holds-the-work-a-seat-drains` is amended in the same PR; the framework's warning keeps its package test |
| `support.wren`'s drain is a subset: an `escalations` row stays pending. Source: [FIX-1476](../../issues/FIX-1476/BUSINESS-RULES.md) BR-9, goal leg V8 | **Retained**, reworded | The board is now served by a person, not by wren, so the subset still holds | ER-5 | V8's assertion unchanged |
| The epic proof that a clone of kitchen-sink shows "the unattended board warning visible". Source: [FIX-1455 ER-22](../FIX-1455/BUSINESS-RULES.md) | **Amended**: that clause only | Same owner call. The rest of ER-22 (the runtime hire surviving a redeploy, the boards, the subset drain) is untouched | ER-19 | FIX-1455 is Done; nothing to re-run beyond the amended goal |
| The notify block is a stub that names each member and stops; "a real app puts a dispatcher here". Source: `apps/kitchen-sink/workforce/channel-notify.ts` header, shipped by FIX-1476 (#2007) | **Retained** | FIX-1590, which would have replaced it, was cut in review: waking agent seats needs an internal receiver, a package change outside the fence ([D1](DECISIONS.md#d1)) | None in this set; FIX-1590 is the follow-on · ER-12 | Unchanged, as are the skip-the-writer rule and leg V14 |
| `desk-note` answers by returning the note with the seat's desk name, no model. Source: `apps/kitchen-sink/workforce/blocks/desk-note.ts` | **Amended** on the `answer` path | FIX-1589's issue: once reachable, an echo is worse than unreachable | ER-1 · ER-2, built by FIX-1589 | `support.otto` names `desk-note` as a tool; FIX-1589 keeps that path working or says why not in its spec |

Re-check each source against current code before implementing. No row supersedes the channel
and board convention itself (board v1, [FIX-1455 EVOLUTION](../FIX-1455/EVOLUTION.md)).
