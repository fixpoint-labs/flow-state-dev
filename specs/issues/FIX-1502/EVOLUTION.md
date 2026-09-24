# FIX-1502 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Three earlier designs said row 5 could not be built here, or that the inventory stays closed to a
browser. The owner's answer of **2026-09-24, (a)** ([epic D10](../../epics/FIX-1457/DECISIONS.md#d10))
— row 5 is a channel session's view of the whole organization — and the epic's 2026-09-22
settlement are what move each. None is rewritten;
this records which part changed.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1481 D2: row 5 is named there and built elsewhere, **blocked on FIX-1486**, because a read could not be told which organization to read; source [`../FIX-1481/DECISIONS.md#d2`](../FIX-1481/DECISIONS.md#d2) | **Superseded in part** — the *blocked on FIX-1486* ground. Retained: FIX-1481 verifies the checklist, FIX-1502 builds row 5, and the two collections stay distinct from the roster | Choosing among organizations is not needed at one person, one organization; the owner answered (a) on 2026-09-24. The epic's [settlement](../../epics/FIX-1457/DECISIONS.md#settled-org-read) showed the session's own organization is read, isolated, on the production route | [D1](DECISIONS.md#d1) | FIX-1481's shipped code is untouched |
| FIX-1481 guardrail: *do not add a `client` config to the inventory or reference collections to "just make row 5 work"*; source [`../FIX-1481/PLAN.md#guardrails`](../FIX-1481/PLAN.md#guardrails) | **Superseded for the inventory collections only.** Retained for the reference collections | Same evidence as above. The read is added as a signed contract change, not to make a row pass | [D1](DECISIONS.md#d1), S1 | Reference collections unchanged |
| FIX-1405's inventory collections: *"Takes no options. The prefix, the scope and the sharing are the contract other layers join against, not app settings"*; source `packages/workforce/src/inventory/collections.ts` as merged in [#1923](https://github.com/fixpoint-labs/flow-state-dev/pull/1923) (no retained spec) | **Amended**: a browser read joins the contract. Retained: no options, the prefix, the scope, the sharing, and that no row is ever deleted | The roster collection beside it already carries the same read with named fields and a cross-organization test | [D1](DECISIONS.md#d1) | Existing rows read as before; no key moves. Readers that never asked see nothing new |
| Epic ER-Devtool row 5, *"Not buildable in W5 today"*, and *"Why FIX-1502 is blocked"*; source [`../../epics/FIX-1457/BUSINESS-RULES.md#devtool-checklist`](../../epics/FIX-1457/BUSINESS-RULES.md#devtool-checklist) | **Superseded** by the owner's answer (a) of 2026-09-24, recorded as the epic's [D10](../../epics/FIX-1457/DECISIONS.md#d10); this spec does not edit the epic | FIX-1502's Linear comment of 2026-09-24 · [epic D10](../../epics/FIX-1457/DECISIONS.md#d10) | This spec | None: a checklist row, not an API |

The hired roster collection's own browser read (FIX-1475) is **precedent, not a predecessor**: it
is followed, not changed.
