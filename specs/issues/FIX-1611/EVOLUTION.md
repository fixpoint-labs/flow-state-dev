# FIX-1611 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

The epic already superseded the old roster itself ([FIX-1592 EVOLUTION](../../epics/FIX-1592/EVOLUTION.md)).
These rows are what that leaves for this issue: earlier designs whose kitchen-sink half, or whose
check, changes here. Retained specs are not edited.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The clerk's one tool files through the channel's own `fileTask`, authored as the seat. [FIX-1589 D1](../FIX-1589/DECISIONS.md#d1), [D3](../FIX-1589/DECISIONS.md#d3) | **Retained**, moved onto the built-in kind as `escalate`; `escalations` only | The shape was reviewed and shipped; only the kind it sat on is cut | [D2](DECISIONS.md#d2) · BR-8 to BR-11 | Same `fileTask`, same author rule, same queue-host rescue |
| Answer by default, file only what can't be closed, always reply. [FIX-1589 D2](../FIX-1589/DECISIONS.md#d2) | **Retained** as the specialists' instructions | ER-25 asks for the same | BR-8, BR-9 | The live leg grades it on a real model |
| FIX-1589's check and its `echo` control. `goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it/` | **Amended**: becomes this issue's goal; `echo` retires | `echo` reverted the clerk's own old answer, which the agent kind never had | [D3](DECISIONS.md#d3) · `no-landing`, `no-filing` | Path and anti-game kept |
| Every agent member runs once on a post in kitchen-sink. [FIX-1590 D2](../FIX-1590/DECISIONS.md#d2), its check | **Amended** in kitchen-sink: the routed member once, nobody else | `support.help` is routed; an unrouted channel is FIX-1602's fixture host | BR-4 | FIX-1590's controls kept; the every-member rule is unchanged in Workforce |
| Kitchen-sink's notify sends a name-only line to members that can't hear. [FIX-1602 D3](../FIX-1602/DECISIONS.md#d3) | **Amended**: no fallback | Every member is an agent seat | Plan S4 | The line survives as the `name-only-notify` control; `a-fresh-host-wakes-its-member-agents` unchanged |
| One kind→action map; a kind with none gets no composer. [FIX-1585 D3](../FIX-1585/DECISIONS.md#d3) | **Retained**, one row (ER-6) | — | BR-15 | The read-only leg uses a seat injected at the network |
| The app is the subject of the channels check: three channels, a custom kind, a drain, one board unattended. [FIX-1476 D2](../FIX-1476/DECISIONS.md#d2), [D3](../FIX-1476/DECISIONS.md#d3) | **Amended**: legs whose subject left move to a fixture tree in the check's folder; the unattended board is **retained** | D8 cut the custom kind, the DM and the drain | BR-12, BR-25 | Each leg keeps its recorded red state |
| Open a declared seat, hire another from the page, open the hire. [FIX-1500 D1](../FIX-1500/DECISIONS.md#d1), [D5](../FIX-1500/DECISIONS.md#d5), its VG | **Superseded in part**: the hire half retires; the declared half is retained | No seat hired while the app runs shows in the rail after D8 | [D3](DECISIONS.md#d3) · BR-26 | FIX-1415 restores it with page hiring |
| The durable-hire check grades a token in the clerk's `desk` setting. FIX-1475's check, `goals/workforce-conventions/durable-hire-survives-redeploy/goal.md` | **Amended**: the token rides `instructions`, read back by `[scenario:recall]` | `desk` left with the clerk (epic EVOLUTION) | BR-16, BR-17 | Legs 0 to 5 and the degrade leg unchanged |
| A terminal hire by `support.mara` proves the CLI runs in the app's organization. [FIX-1551 D1](../FIX-1551/DECISIONS.md#d1), its check; the epic EVOLUTION's "`cli-principal` … move to fixture hosts" | **Amended**: stays on the real app, `support.general` runs, its conversation is read from the store | The subject is this app's resolver; a fixture host has a different one | BR-18 | Same principal and store legs; same placeholder-ask control |
| A custom kind and a custom block reach a Next build from files alone. FIX-1357 (no retained spec); `goals/workforce-conventions/code-comes-from-files-alone/goal.md` | **Amended**: the block half on the real app through `escalate`; the kind half on a fixture host | D8 cut the app's custom kinds | Plan inventory | The Next-built anti-game rides the same generated module |

Before implementing, compare each row with the current goal files and code; approval of the
intent does not establish what has shipped.
