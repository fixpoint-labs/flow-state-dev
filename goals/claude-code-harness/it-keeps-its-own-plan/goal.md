# claude-code-harness › it keeps its own plan

**Issue:** FIX-1185
**Outcome:** A host runs Claude Code from a flow with `recordWork` on and gives it no
prompt of its own. On a multi-step job that never mentions planning, the agent keeps its
own to-do list as it works, and anyone reading the run's plan record afterwards sees that
list, with items moving to completed. Before this, the record was empty on every real run.
**Input:** `fixtures/jobs.json`, two held-out jobs of three or more steps on a small seeded
checkout. Neither names a tool or says anything about planning; `run.mts` refuses a job
that does. Runs alternate between them, so the PASS covers both inputs. Swap in any other
job of that shape and a correct implementation still passes: nothing below reads the jobs'
content.
**Signal:** On each run, read back through the app's resource route
(`GET /sessions/:id/resources/observed-plan?topicPrefix=observed-plan/<requestId>/`):
1. `run:finished` — the run's handle reports `outcome: "finished"`.
2. `plan:rows` — the plan record holds at least two rows for that request.
3. `plan:completed` — at least one of them has status `completed`.
3 of 3 runs, each in a fresh session and checkout.
**Anti-game:** The job never names `TaskCreate` or asks for a plan, so a pass is the agent
planning on its own, not following an instruction. Rows are read from stored state under
the run's own request prefix, never counted from `tool_use` items in the stream and never
parsed from the closing message, so a run that called the tools while the recorder wrote
nothing fails. Each run has its own session, so no run can borrow another's rows. The PASS
arm never passes a prompt string. Settings sources are off (`settingSources: []`), so a
`CLAUDE.md` on the host that mentions planning cannot steer the run. The stream is tapped
only for the evidence line (the model and whether the plan tools were offered), never for
grading.
**Model:** real — Claude Code's own default (no `model` option), on a host where Claude
Code can reach a model. The evidence line prints the model the run reported.
**Run:** `pnpm tsx goals/claude-code-harness/it-keeps-its-own-plan/run.mts`
(`GOAL_RUNS=<n>` overrides the run count)
**Controls:** `GOAL_CONTROL=empty-prompt` gives the run `systemPrompt: ""`, the blank start
every run had before the default changed. It must fail `plan:rows` on 2 of 2 runs.
Running the goal on a checkout from before the change must fail the same way.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-12 | 0f83922c4 | claude-sonnet-5 (Claude Code default, Agent SDK 0.3.234) | FAIL | 0 of 3 runs: 0 plan rows each; `system/init` lists no `TaskCreate`/`TaskUpdate`, so the plan tools were never offered. Runs finished and did the jobs. Run in a cloud session whose Claude Code reaches a model through the host. |
| 2026-10-12 | 0f83922c4 | claude-sonnet-5 | FAIL (expected) | `GOAL_CONTROL=empty-prompt`, 2 of 2: 0 plan rows, tools not offered. Fails the same way as the PASS arm, so on this model the control separates nothing. |
| 2026-10-12 | 0f83922c4 | claude-sonnet-5 | n/a (probe) | Scratch variants, not shipped: plan tools opted in through `allowedTools` → offered, 0 rows (3 runs); plus a `systemPrompt` `append` naming the tools → 0 rows (1 run); plus the same sentence in the job prompt → 4 rows, 1 completed (1 run). Headless `claude -p` on the same binary and job: tools not offered, 0 calls. |
