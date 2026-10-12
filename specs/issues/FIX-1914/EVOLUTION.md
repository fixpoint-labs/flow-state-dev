# FIX-1914 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The epic's lineage row for FIX-1455 D7, the rail as the workforce and the app's front; source [`../../epics/FIX-1907/EVOLUTION.md`](../../epics/FIX-1907/EVOLUTION.md), first row, citing [`../../epics/FIX-1455/DECISIONS.md#d7`](../../epics/FIX-1455/DECISIONS.md#d7) | **Amended** as the epic says: the front page is the picker; D7's rail is **retained** inside Flow State mode | The epic's ER-1; the open question's recommended answer | [D1](DECISIONS.md#d1), BR-1, BR-17 | No stored data moves. Sessions, workers and conversations keep their flows and ids. `/` lands on the picker; the shell is at `/flow-state` |
| FIX-1592 D1, the support example as one routed conversation; source [`../../epics/FIX-1592/DECISIONS.md#d1`](../../epics/FIX-1592/DECISIONS.md#d1) | **Retained**, at a new address | Its checks keep running only if it stays reachable as it is ([entry-points POC](poc/entry-points/)) | BR-17, PLAN → Entry points | The 6 entry-point files open `/flow-state`. Under "move it out", this row becomes **superseded in place** and the migration is its own issue |
| `apps/kitchen-sink/CLAUDE.md` → Layout: "`app/page.tsx` — landing page that mounts chat-agent for now. When a second flow lands, this becomes a flow index" | **Superseded**: it becomes a mode index, not a flow index | Modes, not flows, are what a person picks (epic D1) | S4, S5 | The internal line is rewritten in S11 |
| The `workforce-admin` flow is registered only when its setting is present; source [`apps/kitchen-sink/README.md` → Hiring while the app runs](../../../apps/kitchen-sink/README.md#hiring-while-the-app-runs) | **Retained**, followed as precedent | The same posture for a capability nobody should reach by default | [D2](DECISIONS.md#d2), BR-15 | None |

Before implementing, re-check each row against the current shell, README and the epic set; an
amendment to the epic after this spec merged wins.
