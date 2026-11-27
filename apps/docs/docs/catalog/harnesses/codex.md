---
title: Codex
type: catalog
description: Run OpenAI's Codex agent as a coding harness for a worker, or as one block in your own flow, and continue its conversation across runs.
---

# Codex

`@flow-state-dev/codex` runs OpenAI's Codex agent as a block. Codex already has its own loop and its own tools, so the framework does not drive it step by step. The block starts Codex in a directory you choose, sends one prompt, mirrors what the run says and does into the item stream, and returns a result, called a handle.

The handle has the same shape for Claude Code and Cursor, the other coding agents Flow State runs. Code that reads it does not change when the agent does. How a harness fits into a coding task is on [Coding harnesses](../../concepts/coding-harnesses.md).

## What you get

- Codex as one of the harnesses a worker can choose, so a worker moves onto it by changing one line.
- Codex as a block you step in your own flow, with a prompt in and a handle out.
- A conversation you can pick up again, even after a run was cancelled or crashed.
- A check that tells you whether Codex is signed in before a run starts.

## Install it

```sh
pnpm add @flow-state-dev/codex @openai/codex-sdk@0.164.0
```

The SDK brings the `codex` program, and the block refuses any other SDK version. Codex also needs a sign-in and a git repository. The [Harness runs reference](../../reference/harness-runs.md) has the version rule, the sign-in sources and the repository override.

## As a harness

`codexHarness()` is a plain value, not a kit. Put it in the `harnesses` slot of the harness kit with `fill`, which puts values into a slot another kit opened:

```ts title="fsdev.config.ts"
import { codexHarness } from "@flow-state-dev/codex";
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
    harnesses({ workspace }),
  ],
  fill: { [harnesses.slots.harnesses]: [codexHarness()] },
});
```

`workspace` is where runs get their checkouts; [Coding harnesses](../../concepts/coding-harnesses.md) explains it. A worker names the harness by its id, `codex`:

```md title="workforce/teams/desk/workers/coder-codex/WORKER.md"
---
description: Changes the code in the shop's repository, through Codex.
flow: coder
harness: codex
---

Do what the task describes. Keep the change small.
```

The kit supplies the directory, the conversation to resume and the progress feed. A run starts with only the environment variables Codex needs, so a server secret not on that list is left out, and it works in the `workspace-write` sandbox unless your `thread` options set another `sandboxMode`. The filter covers what the run starts with, not what it can read. The [Harness runs reference](../../reference/harness-runs.md) lists the variables and the sandbox modes.

Before each coding task the kit checks that Codex can run. If it cannot, the task fails at once with the reason, and it never falls back to another agent. The check looks for where a credential would come from, so a key Codex later rejects reads as ready.

To move a worker off Codex, change its `harness:` line. A worker that names a harness nobody filled is refused when the app starts; the [Kits reference](../../reference/kits.md) says what the error names.

Slots it opens: none. Slots it fills: `harnesses`, with the id `codex`. It serves no view of its own. The harness kit's `readiness` view has a row for it.

If the machine was never signed in to Codex, the app starts anyway. That row reads not ready, with the reason and the remedy: run `codex login`, or set `CODEX_API_KEY`. A task for a Codex worker fails at once, saying why, without moving to another harness.

## As a step

The same agent is also a block you step in your own flow:

```ts title="src/flows/tidy/blocks/tidy-imports.ts"
import { codexAgent } from "@flow-state-dev/codex";

export const tidyImports = codexAgent({
  cwd: () => "/work/acme-shop",
  thread: { sandboxMode: "workspace-write", approvalPolicy: "never" },
});
// Step it in a flow with { prompt: "Tidy the imports in src/." }
```

The input is the prompt, plus optional `attachments`; the directory, the conversation and the model are configuration, so a model that calls the block as a tool cannot set them. `cwd` points Codex at a directory without fencing it in; `sandboxMode` is the fence. The [Harness runs reference](../../reference/harness-runs.md) lists the options, including `model`, `client` and the Codex options in `thread: { ... }`.

A run Codex itself fails returns a handle with `status: "errored"` and does not throw. A run stopped by a deadline throws and returns no handle. The reference has both shapes and how `cost` is estimated.

To let a model call Codex as a tool, add `createCodexAgentCapability({ cwd })` to a generator's `uses`. It takes the same options.

Started directly, Codex gets the server's whole environment, secrets included, unless you set `client.env`. `codexHarness()` limits it for you; the reference shows how to limit it yourself.

## Continuing a conversation

The handle's `sessionId` is the id Codex gives the conversation. You write `resume` and `onSession`. `resume` returns the stored id, or `null` to start a fresh conversation. `onSession` receives the id as soon as Codex names the conversation:

```ts title="src/flows/tidy/blocks/tidy-imports.ts"
import { codexAgent } from "@flow-state-dev/codex";

// A Map stands in for your own storage. Keyed by flow session, so two sessions never share a conversation.
const saved = new Map<string, string>();

export const tidyImports = codexAgent({
  cwd: () => "/work/acme-shop",
  resume: (ctx) => saved.get(ctx.session.identity.id) ?? null,
  onSession: (id, ctx) => {
    saved.set(ctx.session.identity.id, id);
  },
});
```

The package stores nothing, so the id lives wherever your app puts it. `onSession` fires before any of the run's output is handled, so a run that is cancelled or crashed after Codex named its conversation can be resumed. The next run must use the same `CODEX_HOME`.

An id Codex does not recognise makes the run throw and leaves your stored id alone. The [Harness runs reference](../../reference/harness-runs.md) shows how to detect that failure.

On a task board, the harness kit writes both for you.

## Next

- [Coding harnesses](../../concepts/coding-harnesses.md): the checkout and verdict a run sits inside.
- [Harnesses](./index.md): the kit that opens the slot.
- [Harness runs](../../reference/harness-runs.md): the handle's fields, options, emitted items and errors.
