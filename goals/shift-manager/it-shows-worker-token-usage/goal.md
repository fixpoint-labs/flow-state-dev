# shift-manager › it shows worker token usage

**Issue:** FIX-2145

**Outcome:** A person running Shift Manager opens Usage and sees, under the subscription windows, how many tokens each of their workers used today or over 7 or 30 days, by model and coding harness. Every attempt counts, the numbers are the same in production as in development, a person sees only their own spend, and a dollar figure appears only where a harness reported one on an API key. It reads as usage, never as what is left.

**Input:** DevTeam's tree and `openLab`, served by Shift Manager's command (`lab/fsdev.config.mts`) over one SQLite store, started four times:

1. **past**: the clock pinned 8 days back (`WORKER_USAGE_GOAL_NOW`, set by `lab/goal-env.mts` before anything loads).
2. **dev**: today, development.
3. **production**: `NODE_ENV=production` and `FSDEV_TRACE_OBSERVABILITY` unset (`WORKER_USAGE_GOAL_PRODUCTION=1`, set in `goal-env.mts` because the goal runner sets `NODE_ENV` on every child). The Lab logs how it stood and the check reads that line.
4. **codex**: the coder on `codexAgent`, its client scripted through `resolveCodexClient` and handed an API key.

The coder (and the Error Reporter's drafts) otherwise run on `claudeCodeHarness`, with the Agent SDK replaced by `lab/scripted-sdk.mjs` at its import seam (`sdkSeam` in `controls.mts`). Each attempt of a tagged run sends the answer, `usage` and `total_cost_usd` the setup scripts, and its `accountInfo()` names an API key or a signed-in plan. The chief of staff's model is scripted to file one coder task per `[[usage:<tag>]]` and reports no usage; every other model (the researcher's `openai/gpt-6-luna`) answers "ok" at 4 + 4 tokens a call. No judge. Each leg runs as its own person.

**Signal:** each failure tagged `<leg>:<assertion>`.

- **a**: the researcher (model only) answers twice: its row is 8 in, 8 out, 2 runs (**a:16-tokens**), no cost.
- **b**: the coder on a subscription: 1 000 + 200 under `claude-code`, billing `subscription`, cost `null`, and the view says "cost not reported" (**b:no-cost**).
- **c**: on an API key: 1 000 + 200, `api-key`, $0.42; the view says "$0.42, reported by Claude Code" and "1,200 tokens". The worker section sits under the windows.
- **d**: a, b and c again on the production Lab: each row exactly doubles (**d:same-numbers**).
- **e**: Alice reads 1 200 tokens and Bob 600, each only their own (**e:only-alices**); the query takes no user argument.
- **f**: attempt one answers nothing (300 tokens) and fails its check; attempt two passes (1 200): the row holds 1 500 over 2 runs (**f:1500**).
- **g**: spend written by the past Lab is in the 30-day read and not the 7-day one (**g:not-in-7-days**), after a restart and after a second; the view's period picker agrees and says its days are UTC.
- **h**: a task that fails for good: the Error Reporter's draft run (900 + 100 per run) is under the Error Reporter, in the operator's records.
- **i**: the coder on Codex with a key: 700 + 300 under `codex`, `api-key`, cost `null` (**i:no-cost**), "cost not reported" in the view.
- Every view: the worker section says "usage" and never "left", "remaining" or "limit".

**Anti-game:**
- No assertion reads Workforce's modules or a row written directly. Rows are read through `workerUsage` over the Lab's HTTP door, as each person, and the view in a browser.
- Spend enters as model results and SDK messages only, through the real chain: chief of staff, task board, harness manager, the harness, the request's ledger, the session's request-end hook, the writer.
- Production is a separate process whose own log line says `NODE_ENV=production traces=off`.

**Model:** n/a (scripted models and SDKs).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-worker-token-usage/run.mts` (about a minute).

**Controls:** each patches a module as the Lab loads it (`controls.mts`).
- `GOAL_CONTROL=from-traces`: model calls count only where traces carry usage. Must fail **d:same-numbers**.
- `GOAL_CONTROL=harness-only`: a worker's record counts harness runs only. Must fail **a:16-tokens**.
- `GOAL_CONTROL=last-attempt-only`: each request's spend replaces the record's. Must fail **f:1500**.
- `GOAL_CONTROL=cost-always`: every cost is shown, Claude Code's on a subscription and Codex's estimate. Must fail **b:no-cost** and **i:no-cost**.
- `GOAL_CONTROL=no-user-filter`: the records are the org's. Must fail **e:only-alices**.
- `GOAL_CONTROL=ignore-period`: the query reads every record whatever the period. Must fail **g:not-in-7-days**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-27 | claude/project-thread-w0un9y (tree of a8ca817) | n/a | PASS | 55 s. a: researcher 8 in, 8 out, 2 runs, no cost. b: `claude-code` 1 000 + 200, `subscription`, cost `null`; view "cost not reported". c: 1 000 + 200, `api-key`, $0.42; view "$0.42, reported by Claude Code", "1,200 tokens". d: the production Lab stood `NODE_ENV=production traces=off`; a, b and c doubled exactly (16 + 16; 2 000 + 400; 2 000 + 400 and $0.84). e: Alice 1 200, Bob 600. f: completed after 2 attempts, 1 250 + 250 over 2 runs. h: the task errored after 2 attempts; the Error Reporter's draft run 900 + 100 under the operator. g: 7 days 0 rows, 30 days 4 + 4, after one restart and after two; the view agrees. i: `codex` 700 + 300, `api-key`, cost `null`; view "cost not reported". |
| 2026-10-27 | same, `GOAL_CONTROL=from-traces` | n/a | FAIL (expected) | **d:same-numbers**: the researcher's production turns added nothing (8 + 8 stayed 8 + 8). |
| 2026-10-27 | same, `GOAL_CONTROL=harness-only` | n/a | FAIL (expected) | **a:16-tokens**: the researcher has no row; g's 30 days is empty too. |
| 2026-10-27 | same, `GOAL_CONTROL=last-attempt-only` | n/a | FAIL (expected) | **f:1500**: 1 000 + 200 over 1 run; a reads 4 + 4. |
| 2026-10-27 | same, `GOAL_CONTROL=cost-always` | n/a | FAIL (expected) | **b:no-cost**: $0.42 on a subscription run, in the query and the view. **i:no-cost**: Codex shows a $0.0019 estimate. |
| 2026-10-27 | same, `GOAL_CONTROL=no-user-filter` | n/a | FAIL (expected) | **e:only-alices**: Alice and Bob each read 4 216 tokens, everyone's. |
| 2026-10-27 | same, `GOAL_CONTROL=ignore-period` | n/a | FAIL (expected) | **g:not-in-7-days**: 7 days reads the 8-day-old 4 + 4, in the query and the view. |
| 2026-10-27 | claude/project-thread-w0un9y (532b30a) | n/a | PASS | 42 s, after the Codex review fixes (whole-query Claude Code usage, billing on a retried lookup, resumed budgets, Cursor cache tokens): every leg's numbers unchanged. |
