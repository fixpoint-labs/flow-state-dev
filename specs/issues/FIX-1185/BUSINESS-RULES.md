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
| BR-10 | A real run, no prompt given, works a multi-step job that names no tool | The plan record holds the agent's own to-do items, read back from state, and at least one reaches `completed` | Goal check, 3 of 3 runs |
| BR-11 | The same run with `""` | No plan rows | Goal check control, 2 of 2 runs |
| BR-12 | A run reports no plan at all | Nothing is invented. The record stays empty and the plan panel says "no plan recorded for this turn" ([ER-5](../../epics/FIX-1907/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), FIX-1915's panel) | Existing recorder tests |

## Failure taxonomy

Nothing here is fatal. A prompt shape the SDK rejects fails the run the way any bad SDK option
does today, as a `ClaudeAgentRunError`. A run that plans nothing is not an error: the empty record
is the honest answer.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): on a real model, a run with no prompt
given and a job that names no tool fills the plan record on 3 of 3 runs, and the same check fails
under `GOAL_CONTROL=empty-prompt`. This satisfies the epic's
[ER-7](../../epics/FIX-1907/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt) on the fix
branch, not the finding branch.
