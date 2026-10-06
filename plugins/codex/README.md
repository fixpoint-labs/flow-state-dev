# codex — a Claude Code subagent that runs on Codex

Adds a `codex` subagent to Claude Code. When Claude delegates to it, the work is done by OpenAI Codex through the `codex` CLI on your machine, using your Codex login and `~/.codex/config.toml`. Claude only relays: the subagent runs on Haiku, passes the task through word for word, and returns Codex's final message unchanged.

## Requirements

- The Codex CLI on your `PATH`, signed in:
  ```bash
  npm install -g @openai/codex   # or: brew install codex
  codex login
  ```
- bash (macOS and Linux).

## Install

From the marketplace in this repo:

```text
/plugin marketplace add fixpoint-labs/flow-state-dev
/plugin install codex@fixpoint-labs
```

Or load it for one session while trying it out:

```bash
claude --plugin-dir ./plugins/codex
```

## Use

Ask for it in plain language. Claude picks the agent from its description:

```text
Have Codex review src/auth/session.ts for race conditions. Read-only.
Use the codex agent to add tests for parseConfig in packages/core.
Get a second opinion from Codex on this migration plan: ...
```

Or address it directly with `@agent-codex:codex`, or as `subagent_type: "codex:codex"` from another agent or skill.

Codex sees none of your conversation, so the task has to stand alone: name the files, the goal, and what done looks like.

Each report ends with a footer like:

```text
— via Codex · status: completed · session: 01a1… · log: /tmp/codex-subagent-runs/…/output.log
```

To keep going in the same Codex conversation, ask for a follow-up and include `resume session <id>`.

### Sandbox

| Task says | Codex runs with |
|---|---|
| review, question, analysis, "read-only", "don't change files" | `read-only` |
| anything else | `workspace-write`: edits inside the working directory, no network |
| explicitly asks for full or network access | `danger-full-access` |

The agent never picks `danger-full-access` on its own. Codex never stops to ask for approval in this mode; anything that would need approval is refused.

You can also ask for a specific Codex model or reasoning effort ("use Codex with high reasoning effort") and the agent passes it along.

## How it works

`scripts/codex-run` reads the task on stdin and starts `codex exec` in the background with the chosen sandbox. It then waits up to 9 minutes. A Claude Code Bash call is capped at 10 minutes, and Codex runs often take longer, so if Codex is still working the script returns `status: running` with a run id. The agent keeps calling `codex-run --wait <run id>` until the run finishes.

Each run keeps its prompt, full Codex log, and final message under `$TMPDIR/codex-subagent-runs/<run id>/`. Set `CODEX_RUN_DIR` to keep them elsewhere, and `CODEX_BIN` to use a `codex` that isn't on your `PATH`.

You can run the script yourself:

```bash
echo "Explain what src/index.ts exports" | plugins/codex/scripts/codex-run --sandbox read-only
plugins/codex/scripts/codex-run --help
```

## Limits

- The subagent is still a Claude call (Haiku) that wraps Codex. It costs little, but it isn't zero.
- Codex's intermediate steps stay in the log file. Only its final message comes back to Claude.
- Codex runs wherever Claude Code runs. In a cloud session, that's the cloud container, not your computer, so it needs its own `codex` install and login.

## Tests

```bash
node --test plugins/codex/test/*.test.mjs
```

The tests run `codex-run` against a stub `codex`, so they need neither the real CLI nor a login.
