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
| BR-5 | Any code block on the page | Is a trimmed excerpt of a file in the example, and names that file. No snippet exists only on the page | V5 |
| BR-6 | The page is published | It names no internal issue or PR, and says nothing about a System One package, an OpenRouter Decisions client, a generator fallback, a cascade inside the evaluator, or the kitchen-sink's thinking-style router (ER-9, ER-12) | V5 |
| BR-7 | A link on the page points at a sibling's reference section | The section exists on `main` when the page publishes. A pointer to facets or memory is left out rather than linked to a page that isn't there | `apps/docs` build (broken links fail it) |

## The example

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | Any source file in the example imports something | It is a published `@flow-state-dev/*` package, `ai`, a provider package, or `zod`. Never `labs/`, `apps/kitchen-sink`, `goals/`, or a relative path into `packages/` (ER-12, [D1](DECISIONS.md#d1)) | V1 |
| BR-9 | The example's tests run in CI | They pass with no API key, on the mock evaluation model | V2 |
| BR-10 | `classify` runs | Returns typed answers for a choice, a score and a boolean. `confidence` appears on an answer only when the model gave one; the example adds none | V2 · leg (a) |
| BR-11 | `route` runs on Jev with a clear, urgent billing ticket | Lands on the billing-urgent leaf. With a ticket that fits no branch well, or confidence under an edge's minimum, it lands on review | V2 · leg (c) |
| BR-12 | `routeWithoutConfidence` runs, on any ticket | Lands on review. The trace shows the answer carried no confidence, which is what closed the edge, not a low number ([D2](DECISIONS.md#d2)) | V2 · leg (c) |
| BR-13 | The activator runs with an evaluator passed | A slash command or keyword still resolves first. When neither does, the evaluator picks from the catalog by description. An `ambiguous` answer or an error activates nothing and does not fall back to the generator classifier (ER-5) | V3 · leg (d) |
| BR-14 | The activator runs with no evaluator passed | Slash and keyword resolve as today, and no evaluator block appears in the trace (ER-5) | V3 · leg (d) |
| BR-15 | A reader runs a command from the example's README | It works from the example directory as written. The README says which actions need which credential, and labels `routeWithoutConfidence` as the no-confidence case | V4 |

## The assembled goal

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | The goal runs | It reports each of the six legs of ER-15 by letter, each PASS, FAIL or PENDING, on real providers (ER-13) | VG |
| BR-17 | A leg's slot is not yet wired by its owner | That leg reports PENDING with its owner named, and the overall verdict is FAIL ([D3](DECISIONS.md#d3)) | VG, before FIX-1557 and FIX-1555 land |
| BR-18 | The goal runs with a named subset of legs | Only those legs run, and the exit code reflects only them. The report still lists the others as not run | VG |
| BR-19 | Leg (b) runs | It uses a real generate-only model. The block is refused with the shipped error and no provider request is made (ER-13) | VG |
| BR-20 | Leg (c) runs with the no-confidence control on | A synthetic confidence is injected into the adapter's answers, and leg (c) must FAIL: the tree now routes where it should not | VG control |
| BR-21 | A credential the goal needs is missing, or rejected for inference | The affected legs report blocked, and the run says so. They are never skipped silently or counted as passing | VG |

## Failure taxonomy

Nothing here is a runtime failure path: the example has no error handling beyond what the blocks
ship. In the goal, a missing credential blocks the legs that need it (BR-21), an unwired leg is
pending (BR-17), and both make the overall verdict FAIL. Nothing retries.

## Acceptance criteria this issue owns

The guide is published and in the sidebar. The example's tests pass in CI with no key. Legs (a)
to (d) PASS on real models, recorded in the goal's verdict log with (e) and (f) shown as pending
and owned. The epic's teach rule (ER-16) is met; its proof rule (ER-15) is met when the siblings
wire (e) and (f) and the full goal passes.
