---
sidebar_position: 5
sidebar_label: Claude Code (remote dispatch)
---

# Claude Code remote dispatch

`@flow-state-dev/claude-code/cli` — dispatch a Claude Code cloud task from inside
a flow by shelling out to your local `claude` CLI. You get back a handle, not a
live stream.

## When to use it

Reach for this when a flow needs to hand a coding task to a cloud agent and keep
working: a long autonomous refactor, a build-and-fix loop, or an orchestrator
that dispatches work and references it later. It is how flow-state-dev triggers
the same `claude --remote` tasks the team runs by hand.

It is deliberately not the [bash tool](./bash.md). The bash tool runs commands in
a bounded sandbox. This runs your host machine's already-authenticated `claude`
CLI — a different, trusted, opt-in trust model.

It is fire-and-forget. The CLI has no headless way to poll or stream a cloud
task's progress yet, so the block dispatches and returns. Watch progress with
`/tasks` in the CLI, on claude.ai, or from the mobile app.

## How it works

`claude --remote "<instructions>"` creates a cloud session on claude.ai. The
cloud VM clones your repository's GitHub remote at your current branch, so push
local commits first — the VM clones from GitHub, not your working tree. The block
parses the session URL from the CLI output, persists a handle, emits a status
item, and returns the handle.

## Opt-in and trust

A capability is a reusable bundle you attach to a block. Installing this one is
the host's explicit statement that the process may run `claude`; nothing shells
out otherwise.

```ts
import { generator } from "@flow-state-dev/core";
import { createClaudeCliCapability } from "@flow-state-dev/claude-code/cli";

const planner = generator({
  name: "planner",
  model: "openai/gpt-5.4-mini",
  uses: [createClaudeCliCapability()],
});
```

`resolveClaudeCli` is the seam that supplies the binary path, working directory,
and environment. The default resolves `claude` from `PATH`; pass your own to
point at a specific binary or to mock the subprocess in tests.

## Dispatch as a sequencer step

When the host (not the model) decides to dispatch, use the handler directly:

```ts
import { claudeRemoteDispatch } from "@flow-state-dev/claude-code/cli";

const dispatch = claudeRemoteDispatch({ cwd: "/path/to/repo" });
// seq.step(dispatch) with input { instructions: "Execute docs/migration-plan.md" }
```

## Session state

Each dispatch appends a handle to `claudeRemoteTasks` in session state, so a
later request can reference it:

| Field | Meaning |
|-------|---------|
| `source` | Always `"cli-remote"`. |
| `status` | Always `"dispatched"` in this version. |
| `sessionId` | Cloud session id, when found in CLI output. |
| `url` | claude.ai session URL, when found. |
| `instructions` | The dispatched instruction string. |
| `raw` | Verbatim CLI stdout, kept so nothing is lost if parsing misses. |
| `dispatchedAt` | Epoch millis. |

```ts
const tasks = ctx.session.state.claudeRemoteTasks ?? [];
```

## Error handling

| Situation | Behavior |
|-----------|----------|
| `claude` binary can't be launched | Throws `ClaudeCliNotFoundError`. Install the CLI or fix the resolver. |
| Wrong auth (API key, not claude.ai) | Non-zero exit → `ClaudeRemoteDispatchError` carrying stderr. |
| Dispatch call exceeds the timeout | Aborted → `ClaudeRemoteDispatchError`. |
| Exit 0 but no URL in output | Treated as dispatched: handle with `url: null`, raw output retained, a warning status item. No throw. |
| Empty instructions | `ClaudeRemoteDispatchError` before anything runs. |

## Limitations

No headless progress polling or streaming today — that waits on the CLI exposing
a machine-readable cloud-task status surface. The persisted handle and its
`status` field are shaped to absorb that follow-up without a breaking change.

For an agent that runs in-process and streams its work rather than dispatching to
the cloud, see the [Claude Code SDK agent](./claude-code-sdk.md).

See also: [Tools overview](./overview.md), and the
[CLI](../cli/overview.md) for running flows locally rather than dispatching to
the cloud.
