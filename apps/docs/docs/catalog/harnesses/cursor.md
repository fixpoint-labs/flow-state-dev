---
title: Cursor
type: catalog
description: Run Cursor's coding agent as a coding harness for a worker, or as one block in your own flow, with a message that can join a turn while it runs.
---

# Cursor

`@flow-state-dev/cursor` runs Cursor's coding agent as a block. Cursor has its own loop, tools and idea of when it is done, so the framework does not drive it step by step. The block starts or resumes a Cursor agent in a directory you choose, sends one prompt, mirrors what the run says and does into the item stream, and returns a result, called a handle.

The handle has the same shape for Claude Code and Codex, the other coding agents Flow State runs. Code that reads it does not change when the agent does. How the shared result and harnesses fit together is on [Coding harnesses](../../concepts/coding-harnesses.md).

## What you get

- Cursor as one value in the harnesses slot, so a worker moves onto it by changing one line.
- Cursor as a block you step in your own flow, with a prompt in and a result out.
- A message sent while a turn runs can join that turn. Of the three coding agents, only Cursor accepts a message into a turn that is already running.
- A check that tells you whether Cursor is signed in before a run starts.

## Install it

```sh
pnpm add @flow-state-dev/cursor @cursor/sdk@1.0.40
```

Cursor signs in with a `CURSOR_API_KEY` or a stored login. Cursor runs only on the local machine; a cloud agent is refused when the block is built. The sign-in check and the pinned SDK version are in [Harness runs](../../reference/harness-runs.md).

## As a harness

`cursorHarness()` is a plain value, not a kit. Put it in the `harnesses` slot of the harness kit with `fill`, which puts values into a slot another kit opened:

```ts title="fsdev.config.ts"
import { cursorHarness } from "@flow-state-dev/cursor";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";

const repo = "/work/acme-shop";

const workspace = localWorkspaceHost({
  root: "./runs",
  remotes: { allow: [] },
  localRepositories: [repo],
  source: () => ({ kind: "repo", repo }),
});

export default createFlowState({
  kits: [
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
    harnesses({ workspace, checks: { commands: ["pnpm test"] } }),
  ],
  fill: { [harnesses.slots.harnesses]: [cursorHarness({ model: "composer-2.5" })] },
});
```

`workspace` is where runs get their checkouts. `cursorHarness()` turns Cursor's sandbox off unless you pass `agent: { local: { sandboxOptions: { enabled: true } } }`, so by default a command Cursor runs is not confined to the checkout. Options, defaults, the model id and sandbox settings are in [Harness runs](../../reference/harness-runs.md).

A worker names the harness by its id, `cursor`:

```md title="workforce/teams/desk/workers/coder-cursor/WORKER.md"
---
description: Fixes failing tests in the shop's repository.
flow: coder
harness: cursor
---

Fix what the task describes. Keep the change small.
```

To move a worker off Cursor, change its `harness:` line. Startup refusals for a harness nobody filled are in [Kits](../../reference/kits.md).

Slots it opens: none. Slots it fills: `harnesses`, with the id `cursor`. It serves no view of its own. The harness kit's `readiness` view has a row for it.

## As a step

The same agent is also a block you step in your own flow:

```ts title="src/flows/tidy/blocks/tidy-imports.ts"
import { readFile, writeFile } from "node:fs/promises";
import { harnessEnv } from "@flow-state-dev/core/harness";
import { CURSOR_PASS, cursorAgent } from "@flow-state-dev/cursor";
import { steering } from "../steering";

// One saved agent per flow session, so two sessions never share a conversation.
const idFile = (sessionId: string) => `/work/acme-shop/.cursor-agent-${sessionId}`;

export const tidyImports = cursorAgent({
  cwd: () => "/work/acme-shop",
  model: "composer-2.5",
  env: harnessEnv({ pass: CURSOR_PASS }), // without it, every shell command gets the server's whole environment
  resume: (ctx) => readFile(idFile(ctx.session.identity.id), "utf8").catch(() => null), // the agent to continue
  onSession: (id, ctx) => writeFile(idFile(ctx.session.identity.id), id), // saves the id when Cursor opens the agent
  onSteerable: steering.onSteerable, // see Steering a running turn
});
// Step it in a flow with { prompt: "Tidy the imports in src/." }
```

The block's input, option tables, the error list and `cwd` are in [Harness runs](../../reference/harness-runs.md).

## Moving a worker to a new server

Cursor needs one of two credentials in the run's environment: a `CURSOR_API_KEY`, or a stored login that `Cursor.auth.login()` saved after a browser sign-in. A block can also carry a key as `agent.apiKey`.

To see whether a server is signed in without starting a run, ask `cursorSignIn`:

```ts title="src/lib/cursor-health.ts"
import { cursorSignIn } from "@flow-state-dev/cursor";

export async function cursorIsReady(env: Record<string, string>): Promise<boolean> {
  const signIn = await cursorSignIn(env);
  // { status: "key" }, { status: "login" } or { status: "none", reason }
  return signIn.status !== "none";
}
```

The stored login is looked up under `HOME`, so keep `HOME` the same for the check and for the run.

On the harness path you do not call it yourself. Before each coding task the harness slot checks the environment the run will get, and the harness kit's `readiness` view has a row for `cursor`. A worker naming a harness that cannot run, such as `desk.coder-cursor` on a server with no sign-in, fails at once with the reason and the remedy ("Set CURSOR_API_KEY, or sign in to Cursor"). It never falls back to another agent.

## Continuing a conversation

Cursor calls the durable conversation an agent, and each prompt is one run inside it. The handle's `sessionId` is that agent id.

You write both halves of continuing one. `onSession` stores the id when Cursor opens the agent, before the prompt is sent. `resume` returns it next time; returning `null`, `""` or `undefined` opens a fresh agent.

In `tidyImports` above, `resume` reads the id from a file and `onSession` writes it there.

The package keeps no session state, so the id lives wherever your app puts it. Here that is a file. On the harness path the manager records it. Cursor keeps its agents under `HOME`, so the run that made an agent and the run that resumes it need the same `HOME`.

If the id points at an agent Cursor does not know, the run throws a `CursorAgentRunError` instead of opening a new agent, and the stored id is left as it was. `harnessFailureKind(error)`, from `@flow-state-dev/core/harness`, reads `"unknown-conversation"` for that case and `null` for any other failure.

## What a run gives back

While Cursor works, its assistant text arrives as `message` items and its thinking as `reasoning`. Each tool call, including a change to Cursor's to-do list, is a `tool_output` that is settled with its result. Lifecycle arrives as `status`, and a finished run ends with a kept status like `Cursor run completed in <duration>.`

Read success off the returned handle, not off those status items. `outcome` is `"finished"` or `"failed"`, taken from Cursor's own final record.

Token counts never reach the stream. They ride the handle, with Cursor's detail on `cursorUsage`. `cost` is an estimate and is `null` for most runs, because Cursor's own model ids, like `composer-2.5`, are not in the price table. Read `cursorUsage` for what a run used.

## When a run stops or fails

When a step's deadline or signal fires, the block asks Cursor to stop, releases it, and throws `CursorAgentAbortedError` with the agent id on `sessionId`. No handle comes back. You can resume that conversation: `onSession` ran before the prompt was sent, and the error carries the id too. A command Cursor started can outlive the release. Only the sandbox setting bounds that.

When Cursor itself fails the run, nothing is thrown. The step gets a handle with `status: "errored"`, `outcome: "failed"` and Cursor's message on `failureMessage`, and nothing retries.

## Steering a running turn

A user who types while a turn runs usually means it for that turn. Pass `onSteerable` to the block, as in the step above, and a line can join the turn in flight.

In a flow, `harnessSteering()` wires this to an action:

```ts title="src/flows/tidy/steering.ts"
import { harnessSteering } from "@flow-state-dev/core/harness";

export const steering = harnessSteering();
```

```ts title="src/flows/tidy/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { steering } from "./steering";
import { tidyImports } from "./blocks/tidy-imports";

export default defineFlow({
  kind: "tidy",
  actions: {
    turn: { block: tidyImports, concurrency: "defer" }, // a turn sent while one runs waits for it
    steer: steering.action(),
  },
});
```

What `steer` answers, and when a line waits for the next turn, are in [Harness runs](../../reference/harness-runs.md).

On a task board, the harness manager does this for you: a message sent to a task while Cursor is working goes straight into the running turn, and the run is not stopped. If Cursor turns the message away, the task's next step receives it.

## Next

- [Coding harnesses](../../concepts/coding-harnesses.md): the checkout and verdict a run sits inside.
- [Harnesses](./index.md): the kit that opens the slot.
- [Harness runs](../../reference/harness-runs.md): the result's fields, options, emitted items and errors.
