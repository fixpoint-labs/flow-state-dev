# poc/codex-wire · what the pinned Codex does on the paths Codex mode rests on

Characterization, throwaway, retained as evidence for [DECISIONS.md → Settled](../../DECISIONS.md#settled).

**The question.** Does Codex's real program behave the way FIX-1915's per-turn binding needs
(name a thread, name it again on resume, name nothing when it refuses, survive a stop)? And does
it ever produce the to-do list this issue was asked to record?

**How.** `probe.mjs` drives the real `codex` binary through the real `@openai/codex-sdk` that
`packages/codex` pins, against a scripted Responses endpoint on `127.0.0.1`. The scripted model
calls `update_plan` twice, then replies. No API key, no network, and nothing reads your
`~/.codex`: each run gets a fresh Codex home in a temp directory.

```bash
pnpm install --filter @flow-state-dev/codex...
node specs/issues/FIX-1916/poc/codex-wire/probe.mjs
# the same questions of another release:
CODEX_SDK_DIR=/path/to/node_modules/@openai/codex-sdk node specs/issues/FIX-1916/poc/codex-wire/probe.mjs
```

**What it showed** (2026-10-12, SDK 0.152.1, the pinned version, and 0.162.1, the newest):

| Leg | Result |
|---|---|
| A · a new thread names its id | pass |
| B · a resumed turn names the same id again | pass |
| C · an unknown id: the run fails with `thread/resume failed: no rollout found for thread id …`, names no thread, starts no new one | pass |
| E · a turn stopped mid-run, then the next turn continues the same id | pass |
| D0 · the probe reads the tools Codex offers (self-check: `exec_command` is there) | pass |
| D1 · Codex offers the model `update_plan` | **fails**: offered are `exec_command`, `write_stdin`, `request_user_input`, `apply_patch`, `view_image`, `get_goal`, `create_goal`, `update_goal`, `tool_search`, `web_search` |
| D2 · a scripted `update_plan` call produces a `todo_list` item | **fails**: Codex answers the call with `unsupported call: update_plan`; no item |

D1 was also checked by hand on `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5-codex`,
`gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5`, `o3` and `gpt-4.1` (`CODEX_MODEL=…`): no
`update_plan` on any. D0 is what keeps D1 from passing on a request the probe failed to read.

**Not covered.** A real model, and a ChatGPT-account sign-in, which may load a different model
catalogue. The goal check on a signed-in host covers both.
