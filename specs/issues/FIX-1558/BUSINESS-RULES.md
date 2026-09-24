# FIX-1558 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. *Proved by* names the check in [PLAN.md](PLAN.md#checks). Epic rules
are ER-n ([epic rules](../../epics/FIX-1553/BUSINESS-RULES.md)); FIX-1554's are cited as
FIX-1554 BR-n.

## The gate, per edge

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The answer to `on` names an option that has a branch, the model reported confidence, and the edge has no floor | The edge opens ([D3](DECISIONS.md#d3)) | V1 |
| BR-2 | Same, and the edge has a floor the confidence reaches, equal included | The edge opens | V1 |
| BR-3 | The confidence is below the edge's floor | `ambiguous`, reason `below-floor` | V1 · VG |
| BR-4 | **The model reported no confidence and the edge has no floor** (OpenAI or Anthropic adapters) | `ambiguous`, reason `no-confidence`, visible in the trace. Never the branch the answer named (ER-4; the epic's implementer note) | V1 · V5 · VG |
| BR-5 | No confidence, and the edge has a floor | `ambiguous`, reason `no-confidence` | V1 |
| BR-6 | Jev answered but left confidence out for this question | Same as BR-4 or BR-5: the key is absent, so the edge fails | V1 |
| BR-7 | A confidence that isn't a finite number in [0, 1] | Treated as absent: `ambiguous`, reason `no-confidence` | V1 |
| BR-8 | The model chose an option that has no branch | `ambiguous`, reason `no-branch`. Never a sibling | V1 |
| BR-9 | The evaluator also returned `probabilities`, or a boolean's `probability` | Ignored by the gate. Neither stands in for confidence (FIX-1554 BR-19) | V1 |

## Walking the tree

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | Level 1's edge opens onto `next` | Level 2's evaluator runs on the cascade's own input, not on level 1's answer | V2 |
| BR-11 | An edge opens onto `block` | That block runs on the cascade's input. The cascade's output is that block's output | V2 · VG |
| BR-12 | A gate fails at any level | The author's one `ambiguous` block runs on the cascade's input; its output is the cascade's. No other level or sibling runs after it | V2 · VG |
| BR-13 | A tree is walked | Exactly one model call per level on the path. Levels on other branches never run | V2 |
| BR-14 | The same leaf block sits under two edges | Either edge reaches it; the cascade builds | V2 |

## Failures

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | A level's evaluator fails: provider error, a refused generate-only model, a malformed result | The cascade fails with that error. Not `ambiguous`, no retry, no later level ([D2](DECISIONS.md#d2)) | V3 |
| BR-16 | The cascade sits in a sequencer with `.rescue` for that error | The rescue block runs, as for any failed block | V3 |
| BR-17 | The request is cancelled mid-level | The cascade ends cancelled, not failed and not `ambiguous` | V3 |

## Building the tree

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A branch has both `block` and `next`, or neither | Refused when the cascade is built, naming the cascade and the branch | V4 |
| BR-19 | `on` names no question on the evaluator, or a question that isn't a choice | Refused at build when the questions are static; a type error either way | V4 |
| BR-20 | A branch key isn't one of that choice's options | A type error. Also refused at build when the questions are static | V4 |
| BR-21 | The evaluator's questions are a function of input | The key and option checks are type-level only; at run time an option without a branch is BR-8 | V4 |
| BR-22 | `minConfidence` is outside [0, 1] | Refused at build | V4 |
| BR-23 | `ambiguous` is missing | A type error, and refused at build | V4 |
| BR-24 | A tree reaches a level it is already inside | Refused at build | V4 |

## Trace and resume

| # | When | Then | Proved by |
|---|---|---|---|
| BR-25 | A cascade runs | Each level walked shows its evaluator's row with the answer, and a verdict: the edge taken, or `ambiguous` with its reason and the level | V5 |
| BR-26 | A leaf suspends and the request resumes | No evaluator is called again: the recorded answer replays, the gate re-reads it, and the same route is taken without a route-mismatch error | V5 |
| BR-27 | The DevTool opens that trace | It shows ordinary sequencer, evaluator and router nodes. No new kind | V5 |

## Failure taxonomy

A successful answer that isn't good enough to route is `ambiguous`, with one of three reasons.
A failed or cancelled call is not an answer; it propagates. A tree that can't be walked is refused
before it runs.

## Acceptance criteria this issue owns

From the Linear issue's acceptance sketch: an author-written tree of evaluate steps with explicit
confidence gates (BR-1, BR-2, BR-10); below-gate or missing confidence returns `ambiguous`,
observably, never a sibling (BR-3 to BR-8, BR-25); the utility is separate from the kind, with no
cascade knobs on the block (ER-10, [PLAN.md → Guardrails](PLAN.md#guardrails)). The teach path is
FIX-1556's.

From the epic: **ER-4** (BR-1 to BR-8), and **leg (c)** of ER-15, which this issue proves as VG: a
two-level cascade lands on the gated leaf with Jev, and on `ambiguous` with an adapter that
reports no confidence. **ER-16's** sentence about `ambiguous` is in this issue's docs too
([DOCS.md](DOCS.md)).
