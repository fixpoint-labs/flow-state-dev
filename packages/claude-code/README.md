# @flow-state-dev/claude-code

Claude Code integration for flow-state-dev. The `/cli` entry point dispatches a
cloud coding task by shelling out to your local `claude` CLI; the in-process
Agent SDK surface will live at `/sdk` (separate, optional `@anthropic-ai/claude-code`
dependency). The `/cli` path has no Anthropic SDK dependency — it shells out.

## Installation

```bash
pnpm add @flow-state-dev/claude-code
```

The host machine needs the [Claude Code CLI](https://code.claude.com/docs) installed
and signed in to claude.ai (cloud dispatch requires subscription auth, not an API key).

## Quick start

A capability is a reusable bundle you attach to a block. Installing this one is
the host's explicit opt-in to letting the process run `claude`:

```ts
import { generator } from "@flow-state-dev/core";
import { createClaudeCliCapability } from "@flow-state-dev/claude-code/cli";

const planner = generator({
  name: "planner",
  model: "openai/gpt-5.4-mini",
  uses: [createClaudeCliCapability()],
});
```

The generator can now call the dispatch tool. To dispatch deterministically
instead, use the handler directly as a sequencer step:

```ts
import { claudeRemoteDispatch } from "@flow-state-dev/claude-code/cli";

const dispatch = claudeRemoteDispatch();
// seq.step(dispatch) with input { instructions: "..." }
```

## How it works

`claude --remote "<instructions>"` creates a cloud session on claude.ai that
clones your repo's GitHub remote at the current branch (push first — the cloud VM
clones from GitHub, not your working tree). The block parses the returned session
URL, persists a handle, and returns it.

It is **fire-and-forget**: the CLI exposes no headless way to poll or stream
cloud-task progress today, so the block does not wait or poll. Watch progress via
`/tasks` in the CLI, claude.ai, or the mobile app.

## Trust model

Nothing shells out unless the host opts in by installing the capability (or
passing a resolver). `resolveClaudeCli` supplies the binary path, working
directory, environment, and the exec function — so the binary location is
host-controlled and the subprocess is mockable in tests.

## Session state

Each dispatch appends a handle to `claudeRemoteTasks` in session state:

```ts
type ClaudeRemoteHandle = {
  source: "cli-remote";
  status: "dispatched";
  sessionId: string | null;   // parsed from CLI output when present
  url: string | null;         // claude.ai session URL when present
  instructions: string;
  dispatchedAt: number;
  raw: string;                // verbatim CLI stdout
};
```

A later request reads `ctx.session.state.claudeRemoteTasks` to reference prior
dispatches.

## Limitations

- No headless polling/streaming of cloud-task progress (CLI limitation).
- Dispatches the current branch as pushed to GitHub; push local commits first.
- The exact `claude --remote` stdout shape is undocumented; the parser is
  defensive and falls back to retaining raw output if it can't find a URL.

## Running tests

```bash
pnpm --filter @flow-state-dev/claude-code test
```
