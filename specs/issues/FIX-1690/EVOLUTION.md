# FIX-1690 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1664's open fork: file a turn into a running coding run as its own issue, shaped *stop the run, then continue the same coding session with the person's message as the next prompt*; source [`../FIX-1664/DECISIONS.md#open`](../FIX-1664/DECISIONS.md#open) | **Retained**, and answered | Jake filed this issue after FIX-1663's a4 failed on `899e059` | [D1](DECISIONS.md#d1) and BR-7 to BR-17 carry that shape; [the first fork](DECISIONS.md#open-live) asks whether to add live delivery now | FIX-1664's composer, gap line and BR-16 are replaced by BR-18 and BR-23 here; its screen is otherwise untouched |
| Epic ER-15: the write path is *"Owned by FIX-1664; FIX-1662's composers consume it"*; source [`../../epics/FIX-1649/BUSINESS-RULES.md#what-no-child-may-do`](../../epics/FIX-1649/BUSINESS-RULES.md#what-no-child-may-do) | **Amended**, owner only | FIX-1664 shipped without the operation, as its fork allowed | This issue owns ER-15's operation; the rule's text is unchanged | None |
| FIX-1662 BR-21: `@worker` is *"sent through FIX-1664's named session write; until it merges, the send is disabled"*; source [`../FIX-1662/BUSINESS-RULES.md#workstreams-and-posting`](../FIX-1662/BUSINESS-RULES.md#workstreams-and-posting) | **Amended** | The named write is this issue's door, not FIX-1664's | BR-19 and BR-20 | Posting without `@` (FIX-1662 BR-19) is unchanged |
| FIX-1663's a4 target (*"in `eng.coder`'s session"*) and Part 4's run line (*"a reply from Inbox's composer lands as a turn in the asking seat's session"*); source [`../FIX-1663/PLAN.md#checks`](../FIX-1663/PLAN.md#checks) and [`#part-4--gap-sweep`](../FIX-1663/PLAN.md#part-4--gap-sweep) | **Amended in part**, as [the second fork](DECISIONS.md#open-inbox) recommended | `eng.coder` has no session outside a task run; DevForce's asking EM has no door | a4 reads *`eng.coder`'s running task session*; Part 4's run line as the fork's recommendation words it | Done: FIX-1663's post-merge amendment ([its evolution](../FIX-1663/EVOLUTION.md), PR [#2592](https://github.com/fixpoint-labs/flow-state-dev/pull/2592)); the closure's controls are unchanged |

No predecessor is superseded. The harness manager's ask path (`answered-run-continues-its-session`,
LAB-154) is retained and reused in reverse, not changed. Compare each intent against current code
before implementing: FIX-1664, FIX-1668 and FIX-1663's amendment are on `main`.
