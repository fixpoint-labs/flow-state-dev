# FIX-1833 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1791 BR-13: best fit's one call picks one delegate, by note or description; source [`../FIX-1791/BUSINESS-RULES.md`](../FIX-1791/BUSINESS-RULES.md#routing-a-users-post), BR-13 | **Amended**: the coordinator itself joins the choices on a person's post; picking by note or description is retained | The POC's sets B and A: with delegates alone, a hire is picked onto a delegate | [D1](DECISIONS.md#d1), BR-1 – BR-5 | A coordinator with no description offers exactly today's choices |
| FIX-1791 BR-15 and BR-16: a failed call or a non-delegate pick goes to the fallback, else the judgment turn; source the same table, BR-15 and BR-16 | **Amended**: two new misses, below the floor and no confidence, take the same path; a pick of the coordinator goes straight to the turn, skipping the fallback. The order itself is retained | A pick of the coordinator is an answer, not a miss | [D1](DECISIONS.md#d1), BR-7 – BR-12 | A coordinator with no `minConfidence:` places as today |
| FIX-1791 D2: a post best fit can't place goes to the fallback delegate, else the coordinator's turn; source [`../FIX-1791/DECISIONS.md#d2`](../FIX-1791/DECISIONS.md#d2) | **Retained** | Its order is the ladder the new misses follow | — | — |
| FIX-1791 BR-33: the DevTeam chief of staff runs on the coordinator flow, routing by judgment; source [`../FIX-1791/BUSINESS-RULES.md`](../FIX-1791/BUSINESS-RULES.md#the-chief-of-staff), BR-33 | **Superseded in part**: it now routes by best fit, with Jev and a floor of 0.7. Running on the coordinator flow, first on the roster, is retained | The product owner's call on 2026-10-09; the POC | BR-17 – BR-21 | Its tools, instructions and model are unchanged |
| FIX-1610 D1: a post sent while a specialist still works the last one goes to it, with no call; source [`../FIX-1610/DECISIONS.md#d1`](../FIX-1610/DECISIONS.md#d1), carried into the coordinator by FIX-1791 | **Retained**, now with a cost named: the window where an ask for the coordinator lands with a delegate | [D2](DECISIONS.md#d2) | BR-13, BR-21 | — |

The epic's [D8](../../epics/FIX-1786/DECISIONS.md#d8) (a coordinator classifies first, and acts
as an agent only when no path is obvious) is applied here, not changed. Before building, compare
these rules with `best-fit.ts` and `coordinator-flow.ts` on `main`: #2955 changes the same
evaluation's state.
