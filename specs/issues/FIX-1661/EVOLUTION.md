# FIX-1661 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1629 BR-22: no engine or core route, type or verb is added. Source: [`../FIX-1629/BUSINESS-RULES.md#what-none-of-this-may-do`](../FIX-1629/BUSINESS-RULES.md#what-none-of-this-may-do) | **Superseded in part.** One field is added to the request record and its client type. The ban on new routes and verbs is retained | Twelve review rounds on PR #2347 each found a new case in the inference BR-22 forced (commits `b8ad96ffe` through `002609cc1` on `task-actions.ts`) | [D1](DECISIONS.md#d1), [BR-19](BUSINESS-RULES.md#what-none-of-this-may-do) | Additive and optional; old records list with the field absent |
| FIX-1629 BR-15 and *Decided, not asked* "The row reads the result from the request's root trace". Sources: [`../FIX-1629/BUSINESS-RULES.md#changing-a-task-from-its-row`](../FIX-1629/BUSINESS-RULES.md#changing-a-task-from-its-row), [`../FIX-1629/DECISIONS.md#decided-not-asked`](../FIX-1629/DECISIONS.md#decided-not-asked) | **Amended.** The promise stands: a refusal is shown in words and never as success. Where the row reads it from changes, and "outcome not visible with traces off" becomes "no result recorded for this request" | The engine already returns `output` and `error` to in-process callers at the final write | [D2](DECISIONS.md#d2), BR-13 to BR-18 | A new DevTool against an older server, or pre-upgrade history, shows *no result recorded* |
| FIX-1629 BR-10: an action is scoped to a board by its name suffix. Source: [`../FIX-1629/BUSINESS-RULES.md#changing-a-task-from-its-row`](../FIX-1629/BUSINESS-RULES.md#changing-a-task-from-its-row) | **Retained** under the recommendation; open to change on [the fork](DECISIONS.md#open) | A wrong guess is refused by the action and writes nothing | none unless the fork says now | n/a |
| FIX-1660 (open bug, no spec): keep the stream-only log so a transient refusal survives a stream handover | **Superseded** once this ships; its fix lands first | BR-18 makes the stream irrelevant to the row | BR-18 | Its regression test is kept or replaced |

FIX-1629's accordion rows, action qualification by `taskId`, and `taskToolActions` are
dependencies, not replaced designs. Compare these rows with current `main` before building;
the FIX-1629 spec is approved intent, and the code has moved since it merged.
