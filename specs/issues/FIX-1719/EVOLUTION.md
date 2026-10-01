# FIX-1719 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Epic Q2's recommendation and ER-4 / ER-20: every hire and every fire is an approval; [`../../epics/FIX-1650/DECISIONS.md#q2`](../../epics/FIX-1650/DECISIONS.md#q2), [`BUSINESS-RULES.md`](../../epics/FIX-1650/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt) | **Amended**: hire does not ask; fire and repair do | Jake on #2602 (comment 5937962361): "For now, ops can just hire without asking." The epic amendment recording it is in flight | [D2](DECISIONS.md#d2) | Hire approval returns by adding `hire` to `askBefore` |
| Epic Q2's recommendation: two org seats, CoS and Ops, with Ops holding hire and fire; [`../../epics/FIX-1650/DECISIONS.md#q2`](../../epics/FIX-1650/DECISIONS.md#q2) | **Amended**: one org seat, CoS, holds hire and fire; other seats ask it by message | Jake's call relayed on #2613 (comment 5939127612), being confirmed with him; amendment #2609 records it | [D3](DECISIONS.md#d3) | Nothing shipped; no Ops template exists to remove |
| FIX-1414: org-level workers either become real addressable seats or are refused loudly; Linear FIX-1414 and the Architect's spec bar (no repository artifact; closed Done 2026-09-18 with no change on `main`) | **Retained**, built here: real seats, a teamless id | `read-workforce-directory.ts:14-16` still passes over `org/workers/`; `published-tree-surface.test.ts:168-175` still names FIX-1414 | [D1](DECISIONS.md#d1), PLAN S1 to S3 | Trees with no `org/workers/` are unchanged |
| A declared seat's id is `<team>.<name>`; `workers-on-disk.md` → "A worker's identity", `read-workforce-directory.ts:341` (`mintWorkerId`) | **Amended**: an org seat's id is its folder name | Every dot-splitting reader is listed by [`poc/id-readers/check.mjs`](poc/id-readers/check.mjs) | PLAN S2 | Team seat ids unchanged |
| The seat-hire tools mint and retire with no gate; [`seat-hire-capability.ts`](../../../packages/workforce/src/seat-hire-capability.ts) header, FIX-1480 | **Amended**, additively: an optional ask before named verbs | ER-20 | PLAN S4 | Omitted, behaviour is today's |

Nothing is superseded. FIX-1621 is a dependency, not a predecessor: it owns the fire path this
issue calls.
