# FIX-1663 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Added with the post-merge amendment ([How it got here](DECISIONS.md#how-it-got-here)). Only the
designs this amendment touches outside this folder.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Epic FIX-1649, *"Leg c's sweep, pinned once"*: the react chrome App Lab mounts (navigator, roster, board panels, seat detail), every registry component App Lab copies, the devtool page; source [`../../epics/FIX-1649/SPEC.md#the-goal-and-how-well-know-its-met`](../../epics/FIX-1649/SPEC.md#the-goal-and-how-well-know-its-met) | **Amended**, narrowed for this closure | Shift Manager imports no react chrome (`labs/shift-manager/src` imports only hooks and the item renderer from `@flow-state-dev/react`); the task plan card and FIX-1655's twelve fixes were never promised to draw. EM call with FIX-1688/1689, [#2532](https://github.com/fixpoint-labs/flow-state-dev/pull/2532) | [PLAN → Leg c's sweep](PLAN.md#checks): message, reasoning, tool, code block and ask cards, and the devtool page | The epic's text is not edited here; its wrap or an epic amendment reconciles it. Leg c's control and value list are unchanged |
| FIX-1690's request of this spec: a4 reads *`eng.coder`'s running task session*, and Part 4's run line as its second fork words it; source [`../FIX-1690/EVOLUTION.md`](../FIX-1690/EVOLUTION.md) and [`../FIX-1690/DECISIONS.md#open-inbox`](../FIX-1690/DECISIONS.md#open-inbox) | **Retained**, applied | FIX-1690 merged its spec ([#2525](https://github.com/fixpoint-labs/flow-state-dev/pull/2525)) and its three PRs (#2538, #2544, #2565) | PLAN a4, Part 4's ER-15 row, QR-9 | The controls are unchanged; `optimistic-post` still fails a4 |
| FIX-1662's and FIX-1664's pinned paths under `goals/app-lab/` and `labs/app-lab`, and the start command; provenance [#2588](https://github.com/fixpoint-labs/flow-state-dev/pull/2588), which renamed them after both specs merged | **Amended**, names only | The rename to Shift Manager; their specs stay as written, as design history | `goals/shift-manager/…`, `labs/shift-manager`, `--team devteam`, `--shift day\|night` | `goals/devforce-lab/` and `DEVFORCE_LAB_*` keep their names |

No predecessor is superseded.
