# FIX-1650 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans more than one child. Child-specific lineage belongs in each child's own
evolution record.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1649's ownership row gives FIX-1650 the project level and the workstream itself (its channel, its flow, that it exists); [`../FIX-1649/DECISIONS.md#who-owns-what`](../FIX-1649/DECISIONS.md#who-owns-what), amended by #2423 | **Retained** | `labs/shift-manager/src/gaps.ts` names FIX-1650 for the four project entries | FIX-1718 fills them ([ER-8](BUSINESS-RULES.md#what-no-child-may-do)) | The frame is unchanged; only those entries are replaced |
| Channel admin (create, delete, invite) is shaped but not shipped, and worker-facing tools wait for Collab mint; [`../../issues/FIX-1415/DECISIONS.md#recommended-still-open`](../../issues/FIX-1415/DECISIONS.md#recommended-still-open), PR #2084 | **Retained** | FIX-1415 closed as a ratified, not-shipped explore on 2026-09-29; FIX-1341 is still parked | [D3](DECISIONS.md#d3), [ER-3](BUSINESS-RULES.md#what-no-child-may-do) | No runtime channel writes; workstreams stay declared |
| A stored seat whose kind the app no longer carries is refused, named at boot and left unrepaired; [`../../issues/FIX-1611/BUSINESS-RULES.md`](../../issues/FIX-1611/BUSINESS-RULES.md) BR-17, over [`../../issues/FIX-1475/DECISIONS.md#d2`](../../issues/FIX-1475/DECISIONS.md#d2) | **Amended** once FIX-1621 ships: the refusal stays the boot default, and a repair path is added | FIX-1621's problem statement: no path to detect and clear the orphan | [ER-5](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), owned by FIX-1621 | Boot behaviour is unchanged; repair only happens on approval, and no row is rewritten silently |
| FIX-1621's open walls: Ops as a shipped or documented template, delete-only or guided re-hire, banner or Ops seat; its Linear description, 2026-09-28 | **Amended** where Q2 reaches, retained otherwise | The admin seat's role is now this epic's question | Q2 in [DECISIONS.md](DECISIONS.md#q2); the rest stays FIX-1621's spec's call | None; nothing shipped |
| `fire` keeps the inventory row: "registered, not still hired"; `packages/workforce/src/seat-hire-blocks.ts` header and `fire`'s description | **Amended** once FIX-1621 ships | A fired seat must leave TEAMS, which reads the inventory | [ER-19](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), owned by FIX-1621 | Rows written before the change still read; one path for fire and retire |
| No seat can be hired from `org/workers/`: the roster reader passes over it and a seat id needs a team; `packages/workforce/src/loader/resource-walk.ts` and `read-workforce-directory.ts` headers | **Amended** by FIX-1719 ([Q2](DECISIONS.md#q2), answered 2026-10-01) | CoS is declared there | [ER-6](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), owned by FIX-1719 | Additive; team seats and the teams-only readers are unchanged |

No predecessor is superseded. Re-check each cited intent against current code before
implementing.
