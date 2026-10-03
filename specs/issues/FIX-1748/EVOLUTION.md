# FIX-1748 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

This spec renames names earlier designs pinned. It changes no decision they made about behaviour, so every row below is amended in its names or retained whole. None is superseded.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A custom kind lives at `flows/channels/<kind>.ts`, the basename is the kind, and `flow:` in a `CHANNEL.md` must match it; [FIX-1476 PLAN → Pins](../FIX-1476/PLAN.md#pins) | **Amended**, names only. The basename rule, and the ban on naming a custom kind after the built-in, are retained | The owner's lock: "kind storage path … rename with the wire" | `flows/mailboxes/<kind>.ts`, `MAILBOX.md`, built-in `mailbox` ([pinned names](PLAN.md#pinned-names)) | An old path is refused by name (BR-12, BR-13) |
| The inventory's published keys `inventory/seats/*` · `inventory/channels/*` · `inventory/members/*`; [FIX-1481 D2](../FIX-1481/DECISIONS.md#d2), read by [FIX-1502 PLAN → Pinned names](../FIX-1502/PLAN.md#pinned-names) | **Amended**: `inventory/mailboxes/*`, membership field `mailboxId`. Seats and members keys retained | The lock covers keys. The code's own note that moving a key breaks persisted rows is accepted, not missed ([D1](DECISIONS.md#d1)) | [D1](DECISIONS.md#d1), BR-6, BR-14–17 | Rows written before are not carried; Lab stores reset |
| A workstream is a declared channel and the boards attached to it; [FIX-1662 D2](../FIX-1662/DECISIONS.md#d2) | **Retained**, reworded: a declared mailbox and its boards | Workstream names the work, mailbox the conversation | [D3](DECISIONS.md#d3), BR-8 | None needed |
| The `CHANNEL.md` key `mintFor`, `workstream-claims/<channelId>`, and the talk entries; [FIX-1718 PLAN → Pinned names](../FIX-1718/PLAN.md#pinned-names) | **Amended**: the key lives in `MAILBOX.md`; the claim key's shape is retained, since the id carries no word; refusal `talk-on-a-channel` becomes `talk-on-a-mailbox` | Same lock; FIX-1718's last PRs are still landing ([D2](DECISIONS.md#d2)) | [Pinned names](PLAN.md#pinned-names) | Claim rows keep their keys |
| Channel was never L1 substrate, and no Channel type follows; FIX-867 invent-kill, no retained spec ([Linear FIX-867](https://linear.app/fixpoint-labs/issue/FIX-867)) | **Retained** | The lock's invent-kill list repeats it for Mailbox | No L1 Mailbox type, no second pipe | None needed |

Before implementing, compare these names against the code on `main`: FIX-1718's last PRs may move some of them first.
