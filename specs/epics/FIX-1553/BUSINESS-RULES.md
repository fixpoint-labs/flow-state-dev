# FIX-1553 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

These are the rules every child's spec and implementation must satisfy. Each names its owner and
where it is checked. The "no child may" rules restate the owner's invent-kills on
[FIX-1553](https://linear.app/fixpoint-labs/issue/FIX-1553) as rules with owners.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | `evaluator` is a block kind beside `handler`, `generator`, `sequencer` and `router`. It takes state and a map of questions (choice, score, boolean) and returns typed answers. It composes, traces and shows in the DevTool under its own kind | FIX-1554 | Its tests · leg (a) |
| ER-2 | A model that cannot evaluate is refused with an error naming the fix, before any call. Strings and evaluation-model instances both go through `experimental_evaluate`. Nothing falls through to a generate call. Jev is reachable via Gateway (preferred) or through its own library as an optional peer with the author's key; neither makes Jev a hard dependency of any package | FIX-1554 | Its tests, including the direct-Jev path · leg (b) |
| ER-3 | An answer carries confidence and per-option probabilities only when the model returned them. The block never supplies a number the model did not ([D2](DECISIONS.md#d2)) | FIX-1554 decides · FIX-1555, FIX-1557, FIX-1558, FIX-1559 consume | Each consumer's spec review |
| ER-4 | In `cascadingRouter` an edge opens only when the choice matches, the model returned confidence, and, where the author set a floor, that confidence reaches it. Absent confidence fails every edge, floor or not; low fails a floored one. Either lands on the author's `ambiguous` leaf, visibly in the trace, never on a sibling ([D2](DECISIONS.md#d2)) | FIX-1558 | Its tests · leg (c) |
| ER-5 | The skill activator takes an optional evaluator for tier 3. With none, slash, keyword and today's classifier run unchanged. With one, its answer is final ([D3](DECISIONS.md#d3), [D4](DECISIONS.md#d4)) | FIX-1559 | Its tests · leg (d) |
| ER-6 | Facets are evaluator answers stored on a resource when its content is written. A facet search makes no model call | FIX-1557 | Leg (e) |
| ER-7 | Memory runs with no evaluator installed. With one passed, a documented seam calls it | FIX-1555 | Its tests, the seam call · leg (f), the no-evaluator half only |
| ER-8 | Every doc and contract that says "four block kinds", or lists the four by name as the whole set, says five, in the same change that ships the kind | FIX-1554 | Its PR, by the repo-wide sweep in [DOCS.md](DOCS.md#update--the-same-count-everywhere-it-is-stated) |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-9 | Ship or depend on `@flow-state-dev/system-one`, promote `labs/typesafe-jev`, make Jev's library a required (non-optional) dependency, add an OpenRouter Decisions client, fall back to a generator with Zod, auto-retry, or invent confidence | Owner invent-kills |
| ER-10 | Put a gate, a tree, a facet or a confidence floor inside the `evaluator` block | [D2](DECISIONS.md#d2). One place gates |
| ER-11 | Make orchestration, memory or a resource host import Jev or the lab, build its own evaluator, or name a model. Edit the stock agent kind's skill loop | [D3](DECISIONS.md#d3). The stock fence from FIX-1362 and FIX-1363 holds |
| ER-12 | Nest under [FIX-202](https://linear.app/fixpoint-labs/issue/FIX-202), re-parent a related issue, turn a child into the model-string demo ([FIX-1495](https://linear.app/fixpoint-labs/issue/FIX-1495)), treat [FIX-1482](https://linear.app/fixpoint-labs/issue/FIX-1482) as a consumer, or add an API only the kitchen-sink can use | Related, not owned. A demo teaches the surface authors copy |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-13 | A proof leg counts toward the lead measure only when it runs the real path (`fsdev run` or a `goals/` check) against a real provider: a real evaluation model wherever the leg evaluates, a real generate-only model for leg (b). A mocked spec proves the unit, not the leg | Goal 1's bar, applied here. A mock can hand the gate any confidence it wants |
| ER-14 | The blocked-by edges in [PLAN.md](PLAN.md#what-each-issue-entails) are wired in Linear and mirrored as they change. A question that crosses issues comes to this epic; after merge, an amendment is a follow-up PR | The epic wake derives readiness from Linear. The retained set stays canonical |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-15 | On real providers ([ER-13](#how-the-set-is-run)): (a) an `evaluator` answers a choice, a score and a boolean with Jev via Gateway; (b) the same block refuses a generate-only model; (c) a two-level `cascadingRouter` lands on the gated leaf with Jev, and on `ambiguous` with an adapter that reports no confidence; (d) tier 3 activates the right skill through a passed evaluator, and with none passed slash and keyword still resolve and no evaluator code loads; (e) a facet written at index time is found by a search that makes no model call; (f) memory captures unchanged with no evaluator installed. The seam call, ER-7's second clause, is FIX-1555's own test; this goal does not claim it | FIX-1556's assembled goal under `goals/`, with legs (e) and (f) supplied by FIX-1557 and FIX-1555 |
| ER-16 | The docs teach evaluate first, then one cascade, then the activator inject, and say that on a model without confidence every cascade edge routes to `ambiguous` | FIX-1556's teaching page ([DOCS.md](DOCS.md)) |
