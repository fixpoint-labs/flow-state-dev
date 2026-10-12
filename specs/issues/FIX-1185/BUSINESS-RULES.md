# FIX-1185 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Each says what a host or the run does and what happens. The
*proved by* column is the check the plan runs.

## What the run starts from

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A host gives no `systemPrompt` | The SDK is asked for Claude Code's own prompt (the `claude_code` preset), with nothing appended | CI, on the options the SDK receives · goal check |
| BR-2 | A host gives a string, including a long one | The string is forwarded as is and replaces Claude Code's prompt, as today | CI |
| BR-3 | A host gives `""` | Forwarded as `""`: the run starts blank, exactly as every run does on today's `main` | CI · the goal check's control |
| BR-4 | A host gives the preset with `append` | Forwarded as is: Claude Code's prompt plus the host's text | CI |
| BR-5 | A host gives an array of prompt blocks, or any other shape the SDK accepts | Forwarded as is. The SDK validates it, as it does `sandbox` | CI, one array case |
| BR-6 | The block is attached as a capability with any of the above | The same as the block built directly | CI |

## Every run, not only the first

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A detached run resumes an earlier session | The same prompt rule applies on the resumed run; its plan rows are its own | CI, on the resume path |
| BR-8 | A run is in-session (not detached) | The same prompt rule applies | CI |
| BR-9 | `recordWork` is off | The prompt rule is the same. Recording never changes what the agent is told | CI |

## The plan record

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | A real run is given no prompt | The real SDK is handed Claude Code's own prompt. Whether the agent then keeps a to-do list is up to the agent and the model; on today's default model it usually doesn't | Goal check, default arm (`prompt:preset`) |
| BR-11 | A real run is offered the to-do tools and keeps a to-do list | The plan record holds its items, read back from state, and at least one reaches `completed`. With recording off there is no record | Goal check, planning arm · control `no-record` |
| BR-12 | A run reports no plan at all | Nothing is invented. The record stays empty and the plan panel says "no plan recorded for this turn" ([ER-5](../../epics/FIX-1907/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1915's panel) | Existing recorder tests |

## Failure taxonomy

Nothing here is fatal. A prompt shape the SDK rejects fails the run the way any bad SDK option
does today, as a `ClaudeAgentRunError`. A run that plans nothing is not an error: the empty record
is the honest answer.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), as amended. On a real model, a run
with no prompt given starts from Claude Code's own prompt, and the same check fails under
`GOAL_CONTROL=empty-prompt`. A run that keeps a to-do list leaves it in the plan record, and that
check fails under `GOAL_CONTROL=no-record`. This proves ER-7's recorder on a real run. It does
**not** make Claude Code's plan panel fill unasked on today's default model. That gap is the
epic's to weigh ([D1 → Outcome](DECISIONS.md#d1)).
