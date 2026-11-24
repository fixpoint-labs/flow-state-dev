---
title: Bash
type: catalog
description: Run shell commands in a sandbox whose files persist.
---

# Bash

`@flow-state-dev/tools/bash` gives a generator a shell. Commands run in a sandbox, which is a throwaway place that executes them. Files the agent writes there are saved to your resource collections, so they outlive the sandbox.

A resource collection is a set of stored files under a path pattern such as `artifacts/**`. Bash copies each collection into the sandbox before a command runs and copies the changes back afterwards. The sandbox is for execution. The collections are what you keep.

## What you get

`createBashCapability` returns a capability, a bundle you attach with `uses: [bashCap]`. It adds three tools and some guidance text that tells the model where it may write.

| Tool | Input | Returns |
| --- | --- | --- |
| `bash` | `{ command }` | `{ stdout, stderr, exitCode }` |
| `bash-read-file` | `{ path }` | `{ content }` |
| `bash-write-file` | `{ path, content }` | `{ success, refused }` |

The capability installs no collections. It mounts the ones the generator already has, so attach it beside whatever declares them.

## What the default sandbox can do

`createBashCapability()` with no options uses the `just-bash` provider. It is an in-process emulator of bash with 60+ built-in commands, not a real shell. Files live in memory and no real processes start, so `npm install` fails: nothing can be installed. There is no network either, so `curl https://example.com` fails until you allow hosts with `network.allowedUrls`, or everything with `network.dangerouslyAllowFullInternetAccess`.

Install the optional `just-bash` package to use it. Without the package, every command except `find` fails with exit code 1.

To run the host's real binaries (`npm`, `python`, `gcc`), switch to the `local` provider, covered below. It is a real `/bin/bash` on the server host, run as the server's user, and it is not an isolation boundary. For untrusted commands use `moat` (a container) or `vercel` (a remote sandbox).

## Use it

The example is an agent that drafts reports. The `artifacts` collection holds the files it writes.

```ts title="src/lib/artifacts.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const artifacts = defineResourceCollection({
  pattern: "artifacts/**",
  scope: "session",
  stateSchema: z.object({
    path: z.string(),
    hash: z.string(),
    updatedAt: z.string(),
  }),
});
```

```ts title="src/lib/bash.ts"
import { createBashCapability } from "@flow-state-dev/tools/bash";

export const bashCap = createBashCapability();
```

```ts title="src/flows/reports/blocks/report-writer.ts"
import { generator } from "@flow-state-dev/core";
import { artifacts } from "../../../lib/artifacts";
import { bashCap } from "../../../lib/bash";

export const reportWriter = generator({
  name: "reportWriter",
  model: "openai/gpt-6-luna",
  prompt: "Draft reports as files under artifacts/.",
  resources: { artifacts },
  uses: [bashCap],
});
```

Bash finds every collection on the generator and mounts it at its pattern prefix. The collection `artifacts/**` appears in the sandbox at `/workspace/artifacts/`. When the model runs `echo "# Q3" > artifacts/q3.md`, the file is saved to the `artifacts` collection as `q3.md`. A second collection with the pattern `skills/**` would mount at `/workspace/skills/`, and a file goes to the collection whose prefix matches its path most closely.

`/workspace/tmp/` is scratch: files there are never saved, and nothing warns about them. A file outside a mount or `tmp/` is never saved either, and one in the workspace root is dropped with a warning in the server log. The guidance text tells the model this up front, so it writes under a mount or `tmp/`.

Files under `node_modules/` or `.git/` inside a mount are never saved.

## Choose what gets mounted

By default every collection on the generator is mounted and writable. Pass `collections` to mount only some, and use the object form for a read-only mount. A `bash` command's edits to a read-only mount stay in the sandbox and are never saved; `bash-write-file` refuses them. Say the generator also holds a `references` collection that the agent should read but not change:

```ts title="src/lib/bash.ts"
import { createBashCapability } from "@flow-state-dev/tools/bash";

export const bashCap = createBashCapability({
  collections: ["artifacts", { key: "references", writable: false }],
});
```

`exclude: ["logs"]` is the other direction: mount everything except the keys listed. The keys are the property names in `resources`, not the patterns.

## Choose where commands run

Each provider runs commands somewhere different. The capability works the same on all of them.

- `just-bash`, the default, is an in-memory emulator with no network unless allowed. Use it for tests and light analysis.
- `local` runs a real `/bin/bash` on the server host, so `npm`, `python` and `gcc` are available. Use it in development.
- `vercel` runs in a Vercel Sandbox.
- `moat` runs in a container on the same machine and injects credentials on outbound requests, so commands never see API keys. It needs the separate `moat` CLI installed on the host.
- `custom` takes a `Sandbox` object you write.

The Tools reference lists the options for each, and the defaults.

```ts title="src/lib/bash.ts"
import { createBashCapability } from "@flow-state-dev/tools/bash";

export const bashCap = createBashCapability({
  provider: { type: "local", scope: "run" },
});
```

On `local`, `scope` decides who shares a workspace directory. `session`, the default, gives each session one, so a conversation's runs build on each other. `run` gives each request its own, which is what you want when several agents work at the same time. `user` and `org` share one across sessions. `cwd` pins one fixed directory instead of a scoped one. It can't be combined with `scope`, and setting both throws at construction.

`local` runs commands as the same OS user as the server. It is not an isolation boundary, so use `moat` or a container for untrusted commands.

For `vercel`, you pass in the SDK's `Sandbox` class. Importing the SDK yourself lets your bundler trace it for deployment.

```ts title="src/lib/bash.ts"
import { Sandbox } from "@vercel/sandbox";
import { createBashCapability } from "@flow-state-dev/tools/bash";

export const bashCap = createBashCapability({
  provider: { type: "vercel", Sandbox },
});
```

For credentials and cost, see the [Deploying to Vercel guide](../../build/deploy/vercel.md).

## What gets saved

On the first command a sandbox runs, every collection entry is written into it as a file. After each `bash` command and each `bash-write-file`, changed files go back to their collections. Only files that changed are written. `bash-read-file` saves nothing.

Two runs sharing a collection never overwrite each other's changes. If another run changed the file first, this run's edit is not saved. The collection keeps the other run's version, the edit stays in this run's sandbox, and the server log names the path.

A refused `bash-write-file` returns the reason, so the model can react:

```json
{ "success": false, "refused": "\"artifacts/q3.md\" is being written by another run — the write was NOT applied." }
```

A write under a read-only mount is refused every time, and `refused` says retrying won't help. A `bash` command returns its output either way. A refused save from a command shows up only in the server log. [Workspace](./workspace.md) covers the conflict rules in full.

A command that exits non-zero returns its `exitCode` and `stderr` rather than throwing. Reading a file that doesn't exist throws, and so does a provider that can't start, on the first call.

To release a sandbox when a request ends, wire `bashCap.cleanupBlock` into the flow's `request.onFinished`. A sandbox with no commands for 30 minutes is released anyway.

## Lower-level pieces

`createBashTool` returns AI SDK `tool()` objects for `providerTools`. It has no auto-discovery and no guidance text, so you pass each collection yourself. The [Tools reference](../../reference/tools.md) has its signature.

## Next steps

- [Tools reference](../../reference/tools.md): every provider and its options, mounting rules, the sync steps, MOAT setup and the error table.
- [Resources reference](../../reference/resources.md): what a collection needs to be mountable.
- [Workspace](./workspace.md): the package bash uses to copy files in and out.
- [Skills](../skills.md): skill bundle files are reachable in bash when the skills collection is installed.
