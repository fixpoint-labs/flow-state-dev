# FIX-1556 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a reader, the example or the goal does and what
happens. The *proved by* column is the check the plan runs. Epic rules are cited as ER-n
([epic rules](../../epics/FIX-1553/BUSINESS-RULES.md)).

## Reading the guide

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A reader follows the guide top to bottom | It teaches an atomic evaluator first, then one `cascadingRouter` tree, then the activator's evaluator option, in that order (ER-16) | Docs review against [DOCS.md](DOCS.md) |
| BR-2 | A reader is on a model that reports no confidence | The guide says every cascade edge goes to `ambiguous` on that model, whether or not the edge sets a minimum, and points to a plain `router` for branching on the bare answer (ER-16, [epic D2](../../epics/FIX-1553/DECISIONS.md#d2)) | Docs review · V5 |
| BR-3 | A reader has no Jev key and no gateway | The guide shows a non-Jev evaluation model path. Jev's library is presented as an optional install, never a requirement (ER-2, ER-9) | Docs review |
| BR-4 | A reader passes a model that can only generate | The guide shows the refusal the reader will actually see, copied from the shipped error, not from a draft | V5 |
| BR-5 | A source code block on the page (TypeScript, a `SKILL.md`, config) | Is a trimmed excerpt of a file in the example, and names that file in its title. No snippet exists only on the page. A command fence instead runs from the example directory as written (BR-15); an output fence is copied from what the code prints (BR-4). Neither names a source file | V5 |
| BR-6 | The page is published | It names no internal issue or PR, and says nothing about a System One package, an OpenRouter Decisions client, a generator fallback, a cascade inside the evaluator, or the kitchen-sink's thinking-style router (ER-9, ER-12) | V5 |
| BR-7 | A link on the page points at a sibling's reference section | The section exists on `main` when the page publishes. A pointer to facets or memory is left out rather than linked to a page that isn't there | `apps/docs` build (broken links fail it) |

## The example

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | Any runtime source file in the example (every TS/JS file, root `fsdev.config.ts` included) imports something | It is a published `@flow-state-dev/*` package, `ai`, a provider package, `zod`, or a relative path that resolves inside the example's own directory. Never `labs/`, `apps/kitchen-sink`, `goals/`, or any relative path that leaves the example, `packages/` included (ER-12, [D1](DECISIONS.md#d1)) | V1 |
| BR-9 | The example's tests run in CI | They pass with no API key, on the mock evaluation model | V2 |
| BR-10 | `classify` runs | Returns typed answers for a choice, a score and a boolean. `confidence` appears on an answer only when the model gave one; the example adds none | V2 · leg (a) |
| BR-11 | `route` runs on Jev with a clear, urgent billing ticket | Lands on the billing-urgent leaf. With a ticket that fits no branch well, or confidence under an edge's minimum, it lands on review | V2 · leg (c) |
| BR-12 | `routeWithoutConfidence` runs, on any ticket | Lands on review. The trace shows the answer carried no confidence, which is what closed the edge, not a low number ([D2](DECISIONS.md#d2)) | V2 · leg (c) |
| BR-13 | The activator runs with `evaluator: skillEvaluator(model)` | A slash command or keyword still resolves first. When neither does, the evaluator picks from the catalog by description and the bare pick is final: a skill activates, an explicit "no skill" activates nothing, and confidence is never compared to a threshold. An evaluator error fails the activator, as a generator-classifier failure does today, unless the app wraps it in `.rescue`. It never falls back to the generator classifier (ER-5, [FIX-1559 BR-9 to BR-12](../FIX-1559/BUSINESS-RULES.md)) | V3 · leg (d) |
| BR-14 | The activator runs with no evaluator passed | Slash and keyword resolve as today, and no evaluator block is built or resolved. The activator module has no value import of the evaluator helper; the helper module may still load as part of the package. Proved at construction and resolution, not merely by no evaluator row in the trace (ER-5, ER-15 (d), [FIX-1559 V1](../FIX-1559/PLAN.md)) | V3 · leg (d) |
| BR-15 | A reader runs a command from the example's README | It works from the example directory as written. The README says which actions need which credential, and labels `routeWithoutConfidence` as the no-confidence case | V4 |

## The assembled goal

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | The goal runs | It reports on the single PASS/FAIL protocol every goal uses (`goals/lib/verdict.mts`), on real providers (ER-13). Each failure line is tagged with its leg letter from ER-15. A leg not yet wired by its owner is a placeholder failure naming that owner, so the run is FAIL until every leg is real ([D3](DECISIONS.md#d3)). This issue's merge bar is no failure tagged (a) to (d) | VG |
| BR-19 | Leg (b) runs | It uses a real generate-only model. The block is refused with the shipped error and no provider request is made (ER-13) | VG |
| BR-20 | Leg (c) runs with the no-confidence control on | A synthetic confidence is injected into the adapter's answers, and leg (c) must FAIL: the tree now routes where it should not | VG control |
| BR-21 | A credential the goal needs is missing, or rejected for inference | The affected legs report blocked, and the run says so. They are never skipped silently or counted as passing | VG |

## Failure taxonomy

Nothing here is a runtime failure path: the example has no error handling beyond what the blocks
ship. In the goal, a missing credential blocks the legs that need it (BR-21), an unwired leg is a
placeholder failure naming its owner (BR-16), and both make the overall verdict FAIL. Nothing
retries. BR-17 and BR-18 were folded into BR-16 in review; the numbers are not reused.

## Acceptance criteria this issue owns

The guide is published and in the sidebar. The example's tests pass in CI with no key. Legs (a)
to (d) show no failures on real models, recorded in the goal's verdict log with the run FAIL only
on the (e) and (f) placeholders, each naming its owner. The epic's teach rule (ER-16) is met; its
proof rule (ER-15) is met when the siblings wire (e) and (f) and the full goal passes.
