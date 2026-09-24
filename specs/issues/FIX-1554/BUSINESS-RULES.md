# FIX-1554 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what an author or the system does and what happens. The
*proved by* column is the check the plan runs (V-n in [PLAN.md](PLAN.md#checks)). Epic rules are
cited as ER-n ([epic rules](../../epics/FIX-1553/BUSINESS-RULES.md)).

## Asking

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An evaluator with a choice, a score and a boolean question runs on an evaluation model | One provider call. The output is `{ answers }`, one answer per question under its own id, each typed by its question: the choice is one of the declared option keys | V4 · VG |
| BR-2 | Questions are given as a function of input and context | The function runs once per execution; its result is the question set for that call. Answers are typed from its return type | V4 |
| BR-3 | The question set is empty, or a choice has no options, or a score has fewer than two levels | Refused before any call, naming the block and the question | V4 |
| BR-4 | No `state` is configured | The block's input is the evaluated state. With `state`, its result is. A value that isn't a string, array or plain object is refused before any call | V4 |
| BR-5 | The model doesn't support one of the question types asked | Refused before any provider I/O (the SDK checks `supportedQuestionTypes`), surfaced as the block's error with the unsupported type named | V4 |

## Models

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | `model` is a string whose provider package is installed and keyed (`openai/gpt-5.4-mini`) | Resolved directly through that provider's evaluation model | V2 |
| BR-7 | The same string, with no direct package or key but a gateway configured or detected | Resolved through the gateway's evaluation model, as a generator string falls through today ([D1](DECISIONS.md#d1)) | V2 · VG |
| BR-8 | `model` names a gateway explicitly (`vercel/typesafe-ai/jev`) or is `typesafe-ai/jev` | Resolved through that gateway. Jev's own library is never loaded for a string ([D2](DECISIONS.md#d2)) | V2 · VG |
| BR-9 | `model` is an evaluation model instance (Jev's library, `openai.evaluationModel(...)`) | Used as given. Its own key applies; the resolver is not consulted | V3 · V4 |
| BR-10 | `model` is a language model instance, or an FSD generator model | Refused **when the block is built**. The error says to pass an evaluation model and names `evaluationModel(...)` | V1 |
| BR-11 | A string resolves to a provider or gateway that has no evaluation support (an OpenRouter gateway, say) | Refused at first execution, **before any provider call**, naming the provider | V2 |
| BR-12 | `model` is an intent (`intent/…`), an array, or a `selectModel` result | Refused, saying the evaluator takes one model | V1 · V2 |
| BR-13 | No key or gateway can serve the string | The resolver's existing "no provider available" error, before any call | V2 |
| BR-14 | A gateway accepts the id but its server can't evaluate that model | An ordinary provider error from the one call. Never a second call to another model or a generate call (ER-2) | V9 |
| BR-15 | Nothing on action input, headers or metadata can choose the model or its key | The model and credentials come only from the block config and the app's resolver (BP-031) | V2 |

## Answers

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | The model reports confidence for a question (Jev, for choice and score) | That answer carries `confidence`, exactly the reported value ([D3](DECISIONS.md#d3)) | V3 · VG |
| BR-17 | The model reports no confidence (the popular adapters; Jev for booleans) | The answer has **no** `confidence` key. Not `0`, not `null`, not a probability (ER-3) | V3 · VG |
| BR-18 | The model returns a distribution | `probabilities` is passed through unchanged: option keys for a choice, level indices for a score. Absent when the model returned none | V3 |
| BR-19 | A boolean question is answered | `probability` is P(true), always present because the SDK requires it. It is never copied into `confidence` | V3 |
| BR-20 | The SDK rejects the provider's result (a missing answer, a distribution that doesn't sum) | The block fails with that error. No partial answers are returned | V9 |

## Failures and cost

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | The provider call fails (a 5xx, a 429, a timeout) | Exactly one call was made. The block fails with an FSD error carrying the provider's message; `.rescue` in a sequencer catches it like any block error | V9 |
| BR-22 | The request is cancelled mid-call | The abort reaches the provider call; the block ends as cancelled, not failed | V9 |
| BR-23 | An evaluator runs, top-level or nested in a sequencer | Its trace row carries the token usage and the model identity that ran, the same two fields a generator's row carries | V5 |

## Observability and compatibility

| # | When | Then | Proved by |
|---|---|---|---|
| BR-24 | An evaluator runs | Its `block_trace` row has `blockKind: "evaluator"`, the requested model and the question set, and the answers as output | V5 |
| BR-25 | The DevTool opens that trace | The node shows the evaluator kind, its questions and its answers | V6 |
| BR-26 | `fsdev block` is pointed at a file exporting an evaluator | It runs, like any other kind | V7 |
| BR-27 | A trace stored before this change is read | It reads as before. Every reader that branches on kind accepts `evaluator` and still accepts the four | V5 · V6 |
| BR-28 | Any doc or contract states the count of block kinds or lists the four as the whole set | It says five and names `evaluator`, in this PR (ER-8). Dated history is left as written | V8 |

## Failure taxonomy

Configuration faults are refused before a provider call: an instance at build, a string at
first execution. Provider faults are one failed call and a failed block. Nothing retries, nothing
falls back to another model or a generate call, and nothing fills a missing field.

## Acceptance criteria this issue owns

**FIX-1560's four, verbatim** ([epic D1](../../epics/FIX-1553/DECISIONS.md#d1)), and where each is met:

| FIX-1560 acceptance (verbatim) | Met by |
|---|---|
| Public API + capability contract documented (strings + instances; refuse generate-only) | [SPEC.md → What changes](SPEC.md#what-changes), BR-6 to BR-13, [DOCS.md](DOCS.md) |
| Prefer-Jev (Gateway + optional direct peer/API key) + any evaluation-capable model spelled clearly; adapters cited, not a second stack | [D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2), BR-7 to BR-9, [DOCS.md → Evaluation models](DOCS.md) |
| Explicit “no generateObject fallback” and “cascade lives in utility” fences | [Failure taxonomy](#failure-taxonomy), BR-14, BR-21, [SPEC.md → What stays](SPEC.md#what-stays-as-it-is), [PLAN.md → Guardrails](PLAN.md#guardrails) |
| Spec ready for [fixpoint-labs/flow-state-dev#2151](https://linear.app/fixpoint-labs/issue/FIX-1554/impl-core-evaluator-block) without re-opening parent invent-kills | This set: every card sits inside the epic's locks and none reopens one ([DECISIONS.md](DECISIONS.md)) |

**FIX-1554's own** (its Linear sketch): published and resolvable like the others (BR-24, BR-26);
generate-only refused clearly (BR-10, BR-11); gateway Jev, direct Jev and one non-Jev adapter
work and are documented (BR-7 to BR-9); no lab import (ER-9); the changeset names the kind.

**The goal** is VG, run last: Jev on the gateway answers a choice, a score and a boolean, with
confidence on the first two only; a generate-only model is refused before any call.
