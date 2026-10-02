# FIX-1621 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A stored row naming a cut kind costs that seat alone, named at boot, left unrepaired; [`../FIX-1611/BUSINESS-RULES.md`](../FIX-1611/BUSINESS-RULES.md) BR-17 | **Amended**: the boot behaviour is retained; "left unrepaired" ends | The issue's trigger: `support.joe` on `desk-clerk` refused at every kitchen-sink start with no way to clear it | [D2](DECISIONS.md#d2), [D3](DECISIONS.md#d3); BR-1, BR-8, BR-14 | Start behaviour unchanged. Repair happens only when called |
| Skip, name and serve what a retry can't fix; nothing at start deletes or rewrites a row; [`../FIX-1475/DECISIONS.md#d2`](../FIX-1475/DECISIONS.md#d2) | **Retained**, and reused: its per-row check becomes the read's | The reload's refusals already distinguish the three reasons | [D3](DECISIONS.md#d3); PLAN S1 | `reloadHiredSeats` output and wording unchanged (V1) |
| `fire` keeps the inventory row, which "means was registered, not still hired"; `packages/workforce/src/seat-hire-blocks.ts` header and `fire`'s description, `apps/docs/docs/workforce/durable-hire.md` → "Firing", `inventory.md`, `packages/workforce/README.md` | **Superseded** for hired seats | TEAMS reads the inventory, so a fired seat stays on screen; the epic decided it leaves ([ER-19](../../epics/FIX-1650/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), [epic Evolution](../../epics/FIX-1650/EVOLUTION.md)) | [D1](DECISIONS.md#d1); BR-9, BR-22 | Rows left by earlier fires are hidden by the reader, not deleted (BP-030) |
| The inventory never deletes a row; `packages/workforce/src/inventory/open-inventory.ts` and `inventory/collections.ts` headers, `roster/collections.ts` header | **Amended in part**: the binder still never deletes; `fire` deletes one hired seat's own row | The binder's reason (a partial roster at one start) doesn't apply to a fire, which knows exactly which seat it removes | [D1](DECISIONS.md#d1); PLAN S8 | Declared seats' rows unchanged (BR-23) |
| The issue's open walls: Ops as a shipped or documented template, delete-only or guided re-hire, banner or Ops seat; its Linear description, 2026-09-28 | **Amended** by the epic where Q2 reaches, **decided here** otherwise | [FIX-1650 → Decided in review](../../epics/FIX-1650/DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them) | Template and seat: FIX-1719. Re-hire: [D2](DECISIONS.md#d2). Banner: [D3](DECISIONS.md#d3) | None; nothing shipped |

The seat-hire capability (FIX-1480) and plane isolation (FIX-1529) are dependencies, not replaced
designs. Before building, check these against current code: an approved intent is not a shipped one.

<a name="amendment-after-merge-cross-spec-alignment"></a>
## Amendment after merge: cross-spec alignment

The original review is [#2612](https://github.com/fixpoint-labs/flow-state-dev/pull/2612). This
amendment is a new PR from `main`, shared with the epic, FIX-1718 and FIX-1719, on the EM's calls
after a cross-spec review. The approach is unchanged.

| What | Treatment | Why |
|---|---|---|
| "Ops" in SPEC and DECISIONS prose | **Amended** to "chief of staff"; the Linear title and the figures stay | [FIX-1719 D3](../FIX-1719/DECISIONS.md#d3): one org seat, no Ops |
| S5, S6 and V5 | **Implementer note**: a dotless-id case such as `chief-of-staff` | FIX-1719 PR 1 makes org seat ids dotless, and this may land first |
