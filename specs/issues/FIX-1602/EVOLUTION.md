# FIX-1602 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage this issue changes. FIX-1590 is the main predecessor: this issue moves its wake into
the package and drops the table that wake read.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1590 D3: the wake is the app's own notify block, and a Workforce helper was rejected because it would need its own kind-to-entry table. Source: [`../FIX-1590/DECISIONS.md#d3`](../FIX-1590/DECISIONS.md#d3) | **Superseded** | The owner, 2026-09-26, on #2290: the glue would be copied by every app. [POC P1](poc/wake-by-entry/README.md) shows the helper needs no table: a hired seat carries its entries | [D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2) | Kitchen-sink's behaviour is unchanged (BR-16, BR-17). Its conversations continue: same key (BR-11) |
| FIX-1590 D1: the agent kind hears a post through the internal `onChannelPost`. Source: [`../FIX-1590/DECISIONS.md#d1`](../FIX-1590/DECISIONS.md#d1) | **Retained**, and widened into a convention | D2 reads the same entry on any kind | [D2](DECISIONS.md#d2) · BR-6 | No change to the agent kind |
| FIX-1590's wake column and its drift rules: BR-2's reason ("no wake entry in the map"), BR-15 and BR-16. Source: [`../FIX-1590/BUSINESS-RULES.md`](../FIX-1590/BUSINESS-RULES.md), "Who a post runs" and "What stays safe" | BR-2 **amended** (the reason, not the outcome); BR-15 and BR-16 **superseded** | With no table, nothing can drift. The drift test already read the kind's internal entries, which is D2's check | BR-2, BR-20 · S5, S6 | Clerk and runner members still get the name-only line |
| FIX-1590 BR-3: on a post a seat wrote, every other member gets the name-only line. Source: [`../FIX-1590/BUSINESS-RULES.md`](../FIX-1590/BUSINESS-RULES.md), "Who a post runs" | **Amended** for members whose seat would wake | With an effectful fallback, a forged `author` would otherwise make host behaviour run for every member (Codex on #2296) | BR-3, BR-17 | Clerk and runner members keep the line; an agent member gets nothing on a seat's post. No goal check reads that transient line |
| FIX-1590's "Waking an agent seat" recipe for app authors. Source: [`../FIX-1590/DOCS.md`](../FIX-1590/DOCS.md), the channels guide update | **Superseded** | It is the copy the owner flagged | [DOCS.md](DOCS.md) | Apps that already copied it keep working. The guide now points them at the helper |
| Epic ER-6: any per-kind lookup the wake needs is a column in FIX-1585's map. Source: [`../../epics/FIX-1592/BUSINESS-RULES.md#what-no-child-may-do`](../../epics/FIX-1592/BUSINESS-RULES.md#what-no-child-may-do) | **Retained**; its `wake` column is removed | The wake no longer needs a per-kind lookup. ER-10's "no second map" holds more strongly | S5 | The map keeps its answer columns |
| The issue text: kitchen-sink moves onto the helper in a follow-up, not this ticket. Source: the FIX-1602 Linear description, "Soft deps / sequencing" and "Acceptance honesty" | **Superseded** | The owner's call, 2026-09-26: the closure tests what users copy | [D3](DECISIONS.md#d3) | FIX-1602 now blocks FIX-1601 |

The notify slot's contract (FIX-1476: the package carries the policy, the app supplies the
addresses) and the epic's D2 rule are retained unchanged. Compare each source with `main` before
implementing: FIX-1594 lands in the same files first.
