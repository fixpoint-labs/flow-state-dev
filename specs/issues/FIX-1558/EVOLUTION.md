# FIX-1558 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage this issue changes. The epic's own record ([epic EVOLUTION](../../epics/FIX-1553/EVOLUTION.md))
covers the lab as a whole and the count of kinds.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The lab's cascade: `labs/typesafe-jev/src/cascading-router.ts` on [#1903](https://github.com/fixpoint-labs/flow-state-dev/pull/1903) at `b33a072`. A `router` whose `execute` calls evaluate for each level; `model`, `apiKey` and `client` on the router; question options written from branch descriptions; a 0.5 floor when none is set; an optional `minProbability`; a runtime depth cap of 8 | **Superseded** in shape; its gate rule (choice matches and confidence clears, else `ambiguous`) is **retained** | The epic superseded the lab as a whole. Specifically: a model call inside a router's selector breaks the purity contract resume depends on; a model on the router is the second model door epic D3 forbids; the 0.5 default is a threshold nobody chose | [D1](DECISIONS.md#d1), [D3](DECISIONS.md#d3), S1 and S2 in [PLAN.md](PLAN.md#surfaces) | The lab is never merged; nothing ships that used it |
| The lab's reserved name `evaluatedRouter` for a later single-level router | **Superseded** | Owner lock on FIX-1553 (2026-09-21): one name, `cascadingRouter`. A single-level tree is a cascade with one level | `utility.cascadingRouter` | Nothing shipped under the old name |
| `utility.intentRouter`, the shipped classify-and-dispatch utility with `confidenceThreshold` on a generator's self-reported confidence. Source: `packages/core/src/utility/intent-router.ts` | **Retained**, unchanged | The epic moves nothing onto evaluate wholesale. The two gate on different numbers, and the docs say when to pick which | A sibling, not a replacement | Apps on `intentRouter` see no change |
| ER-4 and [epic D2](../../epics/FIX-1553/DECISIONS.md#d2): absent confidence fails every edge, floor or not; adapters return none | **Retained**, re-checked | The POC confirms it on the published adapters and adds that Jev can omit confidence per answer ([Settled](DECISIONS.md#settled)) | BR-4 to BR-6 | — |

Nothing shipped is superseded. Re-check the lab row against `b33a072`, not memory, before
implementing.
