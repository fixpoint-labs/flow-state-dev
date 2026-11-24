---
title: Claude Code
type: catalog
description: Run a Claude Code agent as a coding harness for a worker, or as one block in your own flow, with a check for its sign-in before a run starts.
---

# Claude Code

`@flow-state-dev/claude-code` runs Claude Code as a block. Claude Code already has its own loop, its own tools and its own idea of when a turn is over, so the framework does not drive it step by step. The block starts or resumes a Claude Code run in a directory you choose, sends one prompt, turns what the run says and does into items in the flow's stream, and returns a result, called a handle.

The handle has the same shape for Codex and Cursor, the other coding agents Flow State runs. Code that reads it does not change when the agent does. How a run fits inside its checkout and verdict is on [Coding harnesses](../../concepts/coding-harnesses.md).

## What you get

- Claude Code as one value in the harnesses slot, so a worker moves onto it with one line.
- Claude Code as a block you step in your own flow, with a prompt in and a handle out.
- A check that tells you whether Claude Code is signed in before a run starts.

## Install it

```sh
pnpm add @flow-state-dev/claude-code @anthropic-ai/claude-agent-sdk
```

The Agent SDK is a separate package, and the block builds only against the versions [Harness runs](../../reference/harness-runs.md) lists.

`claudeCode()` is a kit, a feature an app lists in `createFlowState({ kits })`. It needs the `harnesses` kit and fills its `harnesses` slot with a harness named `claude-code`. `claudeCode({ plan: true })` adds a second, read-and-plan-only one, `claude-code-plan`. Codex and Cursor are not kits. They go in with `fill`, covered on [Coding harnesses](../../concepts/coding-harnesses.md).

## As a harness

The install example on [Coding harnesses](../../concepts/coding-harnesses.md) is the whole setup: `harnesses({ workspace, checks })` and `claudeCode()` in `kits`, and a worker file with `harness: claude-code`. Each task then runs in its own checkout and waits on a verdict, as the supervised-run figure there shows.

A run may use `Read`, `Write`, `Edit` and `Bash`, and edits are approved without asking. It loads the working folder's `CLAUDE.md` and `.claude/settings.json`, but hooks in that file do not run. It has no sandbox: the checkout is where the agent is pointed, not a fence, and it can run shell commands as the server's user. The environment variables it starts with, and the refusal for a worker that names `claude-code-plan` without `plan` set, are in [Harness runs](../../reference/harness-runs.md).

## Which credential it needs

A run needs an `ANTHROPIC_API_KEY`, a `CLAUDE_CODE_OAUTH_TOKEN`, or a sign-in made with `claude`.

As a harness, the check is already done. The `harnesses` flow serves a `readiness` view with a row for `claude-code`. Before each task, a harness that is not ready fails the task at once, with the reason and what to run, such as "Sign in with `claude`, or set ANTHROPIC_API_KEY". It never falls back to another agent. Set `logReadiness: true` on `harnesses` to log a table at start.

As a step, ask Claude Code itself with `probeClaudeCodeAccount`:

```ts title="src/lib/check-claude-code.ts"
import { harnessEnv } from "@flow-state-dev/core/harness";
import { CLAUDE_CODE_PASS, probeClaudeCodeAccount } from "@flow-state-dev/claude-code";

export async function assertClaudeCodeCanRun(): Promise<void> {
  const env = harnessEnv({ pass: CLAUDE_CODE_PASS });
  const account = await probeClaudeCodeAccount({ env });
  if (account.status !== "account") {
    throw new Error(`Claude Code can't run: ${account.reason}`);
  }
}
```

The probe spends no model turn and never throws. Pass the same `env` the run will get, so a credential the run cannot see is not counted. It reports where a credential would come from, not that it works: a key that is set but rejected reads `account`. The other statuses, and where a sign-in is looked for, are in [Harness runs](../../reference/harness-runs.md).

## As a step

The block is `claudeCodeAgent`. Its input is `{ prompt }` and optional `attachments`, so you set the directory and session as options to `claudeCodeAgent(...)`, and a model that holds the block as a tool cannot choose them.

```ts title="src/flows/tidy/blocks/tidy-imports.ts"
import { CLAUDE_CODE_PASS, claudeCodeAgent } from "@flow-state-dev/claude-code";
import { harnessEnv } from "@flow-state-dev/core/harness";

export const tidyImports = claudeCodeAgent({
  cwd: () => "/work/acme-shop",
  env: harnessEnv({ pass: CLAUDE_CODE_PASS }), // only the variables Claude Code needs
  settingSources: ["project"], // the repo's settings, not the server user's
  settings: { disableAllHooks: true }, // a hook in the repo does not run
});
```

The block's own defaults include none of these three. Left out, the run gets the server's whole environment, secrets included, and loads every settings file Claude Code finds, so a hook a repository ships runs as the server's user. The `claudeCode()` kit sets all three for you.

```ts title="src/flows/tidy/flow.ts"
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { tidyImports } from "./blocks/tidy-imports";

const tidy = sequencer({ name: "tidy", inputSchema: z.object({ prompt: z.string() }) })
  .step(tidyImports);

export default defineFlow({
  kind: "tidy",
  actions: { tidy },
});
```

Call the `tidy` action with `{ prompt: "Tidy the imports in src/." }`. The handle holds `status`, `outcome`, `finalMessage`, `sessionId` and the rest, plus `resultSubtype` and `toolsObserved`, which are Claude Code's own.

A run that fails or hits its turn or budget limit returns a handle, not an exception. `outcome` is `finished`, `stopped-at-limit` (max turns or budget) or `failed`, and a limited or failed run has `status: "errored"` and an `error` item. A run you cancel throws `ClaudeCodeAgentAbortedError` and returns no handle. The fields, options and error classes are in [Harness runs](../../reference/harness-runs.md).

## Continuing a session

**On a task board, you do nothing.** A retry, an answered question, a message a person types into the running task, or a review's request for changes continues the same coding session. A line typed into a running task stops the run and resumes its session with that line. Only a session Claude Code confirmed is recorded. If it can't find the one it was asked to continue, the next run starts a fresh session, with the brief, the question and the answer in its prompt.

**In your own flow, the flow session does it.** By default the block saves Claude Code's session id in the flow session's state as `sdkSessionId`, and the next request in that flow session continues the same Claude Code conversation. That lasts as long as the flow session's store keeps the id and Claude Code has the conversation.

When Claude Code doesn't have the conversation it was asked to resume, the block marks the failure as `harnessFailure: "unknown-conversation"` on the `ClaudeCodeAgentRunError` it throws.

To keep the id somewhere else, set `detached: true` and pass `resume` and `onSession`. `onSession` is called during the run, as soon as Claude Code names the session, so the id is yours even if the run is cancelled and returns no handle. A cancelled run's `ClaudeCodeAgentAbortedError` also carries `sessionId`, the session to resume, or `null` if Claude Code had not named one yet. Their other timing and limits are in [Harness runs](../../reference/harness-runs.md).

## What it emits while it works

Claude Code's stream becomes items in the flow's stream as the run goes:

| Claude Code does | You see |
| --- | --- |
| Writes text | A `message` item, streamed token by token |
| Thinks | A `reasoning` item |
| Calls a tool | A `tool_output` item. While it runs, a transient status: a `Bash` call's description, otherwise `Using <tool>…` |
| Starts a sub-agent | A `container` item |
| Fails | An `error` item |
| Starts, retries an API call, compacts its context | A transient status such as "Starting Claude Code..." |

When the run ends, a kept status says `Claude Code agent run completed in ...` or `... errored (<reason>).` Afterwards, read the handle's `outcome` to tell finished from `stopped-at-limit` from `failed`. The handle also has `sessionId`, `resultSubtype` and `toolsObserved`. The wording and details are in [Harness runs](../../reference/harness-runs.md).

File operations and pull requests are not items. Alongside the stream, a run records the files its file tools touched (`observed-file-ops`, never their contents), Claude Code's to-do list (`observed-plan`) and the pull requests it opened (`observed-pull-requests`). They are stored as resources on the session that ran, and you read them the way [Resources](../../concepts/resources.md) shows.

## Approving tools

By default the kit's runs ask nothing: its tool list and approved edits cover what a coding task does. To have Claude Code ask before a call, build the worker yourself with `harnessManager({ approveTools: true })` from `@flow-state-dev/harness-manager`, in place of the one the `harnesses` kit sets up, because the kit does not turn approvals on. A call to a tool the harness does not pre-allow then shows as an approval, such as "Allow WebFetch?", in the user's Inbox, the list of things waiting on a user. The kit pre-allows `Read`, `Write`, `Edit` and `Bash`, and a pre-allowed call never asks, so to approve those, give the worker an agent whose `allowedTools` leaves them out. Approvals need durable execution. Only Claude Code asks per call. [Harness runs](../../reference/harness-runs.md) covers `onToolApproval` and what each answer does to the turn.

## Next

- [Coding harnesses](../../concepts/coding-harnesses.md): the checkout, the verdict and the supervised run this plugs into.
- [Harnesses](./index.md): the kit that opens the slot and serves the `readiness` view.
- [Harness runs](../../reference/harness-runs.md): the handle's fields, every option, emitted items, usage and errors.
- [Codex](./codex.md) and [Cursor](./cursor.md): the other two agents, which fill the slot with a value.
