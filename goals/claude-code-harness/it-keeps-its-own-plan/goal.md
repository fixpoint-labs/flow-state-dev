# claude-code-harness › it keeps its own plan

**Issue:** FIX-1185
**Outcome:** A host runs Claude Code from a flow and gives it no prompt of its own. The run
starts from Claude Code's own system prompt, the one the `claude` CLI uses, not from an empty
one. And when the agent does keep a to-do list, anyone reading the run's plan record afterwards
sees that list, with items moving to completed. The folder name is pinned by the spec; the claim
is narrower than it reads. It does **not** claim the agent plans unasked: on Claude Code's
current default model it usually doesn't, and the to-do tools are off unless named in
`allowedTools` (see the verdict log).
**Input:** `fixtures/jobs.json`, two held-out jobs of three or more steps on a small seeded
checkout. Neither names a tool or mentions planning; `run.mts` refuses one that does. Each
job runs once in each arm. Swap in any job of that shape and a correct implementation still
passes: nothing below reads the jobs' content.
**Signal:** Every run gets a fresh session and checkout.
- **Default arm** (no `systemPrompt`, job as written), per job:
  `run:finished` — the handle reports `outcome: "finished"`;
  `prompt:preset` — the real SDK `query()` was handed `{ type: "preset", preset: "claude_code" }`.
  Whether the agent was offered the to-do tools, and how many plan rows it left, is printed and
  not graded.
- **Planning arm** (`allowedTools: ["TaskCreate", "TaskUpdate"]`, and the job asks for them),
  per job, read back through `GET /sessions/:id/resources/observed-plan?topicPrefix=observed-plan/<requestId>/`:
  `run:finished`; `plan:rows` — at least two rows for that request; `plan:completed` — at least
  one has status `completed`.
**Anti-game:** The prompt leg reads what the real SDK was handed, not the block's options, so a
default set anywhere but on the path to the SDK fails. Plan rows are read from stored state under
the run's own request prefix, never counted from `tool_use` items in the stream and never parsed
from the closing message, so a run that called the tools while the recorder wrote nothing fails
`plan:rows`. Each run has its own session, so no run can borrow another's rows. The planning arm
asks for the plan on purpose: it proves the recorder on a real run, and the default arm is the
one that never mentions planning. Settings sources are off (`settingSources: []`), so a
`CLAUDE.md` on the host cannot steer either arm.
**Model:** real — Claude Code's own default (no `model` option), on a host where Claude Code can
reach a model. The evidence line prints the model the run reported.
**Run:** `pnpm tsx goals/claude-code-harness/it-keeps-its-own-plan/run.mts`
**Controls:**
- `GOAL_CONTROL=empty-prompt` — the default arm passes `systemPrompt: ""`, the blank start every
  run had before the change. Must fail `prompt:preset` on both jobs.
- `GOAL_CONTROL=no-record` — the planning arm runs with `recordWork` off. Must fail `plan:rows`
  and `plan:completed` on both jobs.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-12 | 0f83922c4 | claude-sonnet-5 (Claude Code default, Agent SDK 0.3.234) | FAIL | First contract (an unprompted plan, 3 of 3), since replaced. 0 of 3 runs: 0 plan rows each; `system/init` lists no `TaskCreate`/`TaskUpdate`, so the plan tools were never offered. Every run finished (`outcome: finished`); the job's edits were not graded. Run in a cloud session whose Claude Code reaches a model through the host. |
| 2026-10-12 | 0f83922c4 | claude-sonnet-5 | FAIL (expected) | First contract. `GOAL_CONTROL=empty-prompt`, 2 of 2: 0 plan rows, tools not offered. Fails the same way as the PASS arm, so on this model the control separates nothing. |
| 2026-10-12 | 0f83922c4 | claude-sonnet-5 | n/a (probe) | Scratch variants, not shipped: plan tools opted in through `allowedTools` → offered, 0 rows (3 runs); opted in plus a `systemPrompt` `append` telling it to use them → 0 rows (1 run); opted in plus that instruction in the job prompt instead → 4 rows, 1 completed (1 run). Headless `claude -p` on the same binary and job: tools not offered, 0 calls. |
| 2026-10-12 | 213a37f9d+ | claude-sonnet-5 (Claude Code default, Agent SDK 0.3.234) | PASS | Re-scoped contract. Default arm: both jobs handed `{"type":"preset","preset":"claude_code"}`; to-do tools not offered, 0 rows (reported, not graded). Planning arm: inventory 4 rows (1 completed), greeter 18 rows (6 completed, 12 deleted). |
| 2026-10-12 | 213a37f9d+ | claude-sonnet-5 | FAIL (expected) | `GOAL_CONTROL=empty-prompt`: fails `prompt:preset` on both jobs (SDK handed `""`) and nothing else; planning arm passed (4 and 6 rows). |
| 2026-10-12 | 213a37f9d+ | claude-sonnet-5 | FAIL (expected) | `GOAL_CONTROL=no-record`: fails `plan:rows` and `plan:completed` on both jobs (no plan record declared) while the agent called TaskCreate 4 and 6 times; default arm passed. |
