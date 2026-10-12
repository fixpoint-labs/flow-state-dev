# FIX-1907 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans children. Per-harness lineage belongs in each child's own record.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1455 D7 made the rail the workforce, and the README calls Kitchen Sink "a Workforce app you can copy"; source [`../FIX-1455/DECISIONS.md#d7`](../FIX-1455/DECISIONS.md#d7) | **Amended**: the front page becomes the picker; under the recommended answer, D7's rail is retained inside Flow State mode | The ask makes Kitchen Sink the test bed for each harness; the workforce is one of the framework's own flows, not the app's entry | This epic's ER-1 and the [open question](DECISIONS.md#open), owned by FIX-1914 | No stored data moves. Sessions, hired workers and the support desk's conversations keep their flows and ids. Links to `/` land on the picker |
| FIX-1592 D1 rebuilt the support example as one routed conversation; source [`../FIX-1592/DECISIONS.md#d1`](../FIX-1592/DECISIONS.md#d1) | **Retained** under the recommended answer; **superseded in place** only if the owner moves today's app out | Its goals and browser tests keep passing only if it stays reachable as it is | Flow State mode (FIX-1914) | Under the alternative, a migration epic of its own carries the 29 goals and 9 browser tests that reference Kitchen Sink |
| FIX-1701 D1 and D2 put one item-scope reader in core, internal to this repo's harnesses; source [`../../issues/FIX-1701/DECISIONS.md#d1`](../../issues/FIX-1701/DECISIONS.md#d1) | **Retained**, and followed as precedent | The same reason applies to the plan record: one copy in core, because per-package copies drift | D3: the plan record shape in core, owned by FIX-1915. Whether it is published to outside harness authors is FIX-1915's call, with FIX-1701 D2 as the default | Claude Code's existing `observed-plan` rows keep their key and parse (BP-030); the shape moves, the storage key doesn't |
| The Claude Code docs say a run's plan is not a work queue; source [`apps/docs/docs/tools/claude-code-sdk.md#the-plan-is-not-a-work-queue`](../../../apps/docs/docs/tools/claude-code-sdk.md#the-plan-is-not-a-work-queue) | **Retained**, widened from one harness to three | D3 | ER-5 and ER-10 | No behaviour change for Claude Code |

Shipped inputs FIX-1735 (#2654) and FIX-1701 (#2569) are consumed, not superseded. Re-check each
cited intent against current code before implementing.
