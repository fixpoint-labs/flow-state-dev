---
sidebar_position: 4
---

# Bash

`@flow-state-dev/tools` — Execute bash commands in a sandboxed workspace with bidirectional resource sync.

## Why this exists

Agents that write code, run scripts, or manage files need a real filesystem. But agent state should be portable and persistent, not tied to a particular machine. The bash tool bridges these two needs: files live as framework resources for persistence, get materialized into a sandbox for execution, and sync back after mutations.

The sandbox is the execution surface. Resources are the source of truth. A `FileSync` layer handles the bidirectional mapping so you don't think about it.

## Basic usage

The bash tool creates three AI SDK tools: `bash`, `readFile`, and `writeFile`. You pass resource collections to sync, pick a sandbox adapter, and get back tools ready for a generator.

```ts
import { createBashTool } from "@flow-state-dev/tools/bash";
import { providerTool } from "@flow-state-dev/core";

// Inside a handler's execute function:
const { tools } = await createBashTool({
  collections: { files: ctx.session.resources.files },
  provider: { type: "local", cwd: "./workspace" },
});
```

Pass the tools to a generator via `providerTools`:

```ts
import { generator, providerTool } from "@flow-state-dev/core";

const coder = generator({
  name: "coder",
  model: "anthropic/claude-sonnet-4-6",
  prompt: "You can execute bash commands and manage files.",
  providerTools: [
    providerTool("bash", tools.bash),
    providerTool("readFile", tools.readFile),
    providerTool("writeFile", tools.writeFile),
  ],
});
```

Or, define handler blocks that wrap bash operations and pass them as regular `tools`:

```ts
import { handler } from "@flow-state-dev/core";
import { createLocalFsSandbox } from "@flow-state-dev/tools/bash";

const bashCommand = handler({
  name: "bash",
  description: "Execute a bash command in the workspace.",
  inputSchema: z.object({ command: z.string() }),
  outputSchema: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() }),
  execute: async (input) => {
    const sandbox = createLocalFsSandbox({ cwd: "./workspace" });
    return sandbox.executeCommand(input.command);
  },
});

const coder = generator({
  name: "coder",
  tools: [bashCommand],
});
```

The handler block approach is what the kitchen-sink example uses. It integrates naturally with the framework's tool system, typed schemas, and resource access.

## Configuration

```ts
createBashTool({
  // Resource collections to sync into the workspace.
  // Keys are collection names; values are runtime refs from block context.
  collections: {
    files: ctx.session.resources.files,
    artifacts: ctx.session.resources.artifacts,
  },

  // Sandbox adapter. Default: { type: "just-bash" }
  provider: { type: "local", cwd: "./workspace" },

  // Workspace root inside the sandbox. Default: "/workspace"
  destination: "/workspace",

  // Persist sandbox across sessions (requires bashSession resource). Default: false
  persist: true,

  // Sync strategy. "diff" uses content hashing, "full" re-reads everything. Default: "diff"
  syncMode: "diff",

  // Filter which workspace files sync back to resources
  fileFilter: (path) => !path.includes("node_modules"),

  // Rewrite commands before execution
  onBeforeCommand: (cmd) => {
    if (cmd.includes("rm -rf /")) return "echo 'Blocked.'";
  },

  // Override command results
  onAfterCommand: (cmd, result) => {
    if (result.exitCode !== 0) {
      console.warn(`Command failed: ${cmd}`);
    }
  },
})
```

## Sandbox adapters

Each adapter implements the same `Sandbox` interface. Swapping adapters changes where commands run without touching tool or sync logic.

| Adapter | Provider config | Best for | Real filesystem? |
|---------|----------------|----------|-------------------|
| Local FS | `{ type: "local", cwd?: string }` | Development, local agents | Yes |
| Vercel | `{ type: "vercel", sandboxId?: string }` | Production, cloud execution | Yes (remote) |
| Upstash | `{ type: "upstash", boxId?: string }` | Placeholder (FIX-314) | Yes (remote) |
| just-bash | `{ type: "just-bash" }` | Testing, lightweight analysis | No (in-memory) |
| Custom | `{ type: "custom", sandbox: Sandbox }` | Anything else | You decide |

### The Sandbox interface

Any object that implements these four methods works as a sandbox:

```ts
interface Sandbox {
  executeCommand(command: string): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  stop?(): Promise<void>;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

### Direct adapter constructors

```ts
import {
  createLocalFsSandbox,
  createJustBashSandbox,
  createVercelAdapter,
} from "@flow-state-dev/tools/bash";

// Local filesystem
const sandbox = createLocalFsSandbox({ cwd: "/tmp/workspace" });

// In-memory (falls back gracefully if just-bash isn't installed)
const sandbox = await createJustBashSandbox();
```

## Sync lifecycle

When `createBashTool` is called with resource collections:

1. **Hydrate** — all entries from every passed collection are written into the sandbox filesystem under the configured destination
2. **Return tools** — `bash`, `readFile`, `writeFile` are returned as AI SDK tool objects
3. **Auto-flush** — after every `bash` and `writeFile` call, FileSync walks the workspace, diffs via content hash, and upserts changed files back to the appropriate collection. Deleted files are removed from collections.
4. **No flush on read** — `readFile` does not trigger a sync. It reads directly from the sandbox.

### Content hashing

FileSync uses SHA-256 hashes to detect changes. In `"diff"` mode (default), only files whose hash differs from the stored value are written back to resources. This keeps flush cheap even for large workspaces.

### File ownership

During flush, FileSync matches each workspace file back to its owning collection. If a file exists in a collection, that collection keeps ownership. New files that don't match any existing collection entry go to the first collection in the `collections` record.

### Read-only mounts

`createBashCapability` accepts a `readOnlyMounts` option to materialize additional collections into the workspace at a path prefix, without flushing writes back. Intended use case: bundling skill files (from `@flow-state-dev/skills`) so they're reachable via `cat`, `python3`, or any other bash-side tool.

```ts
import { createBashCapability } from "@flow-state-dev/tools/bash";

const bashCap = createBashCapability({
  sessionResources: artifactResources,
  collectionKey: "artifacts",
  readOnlyMounts: [
    {
      resolve: (ctx) => ctx.project?.resources?.skills,
      pathPrefix: ".fsdev/skills",
    },
  ],
  provider: { type: "local" },
});
```

Each mount's `resolve` function is called per block execution with the block context; return `undefined` to skip the mount (e.g. when the corresponding capability isn't installed). Files are written once on first hydrate at `<destination>/<pathPrefix>/<collection-key>`; the flush sweep skips anything under a read-only prefix in both the change-detection and deletion loops.

## Resource definitions

For the resource sync to work, your collections need a state schema that includes `path`, `hash`, and `updatedAt` fields:

```ts
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

const filesCollection = defineResourceCollection({
  pattern: "files/*",
  stateSchema: z.object({
    path: z.string(),
    hash: z.string(),
    updatedAt: z.string(),
  }),
});
```

File content is stored separately via the resource content system (`readContent`/`writeContent`), not in state. State holds metadata only.

## Error handling

| Scenario | Behavior |
|----------|----------|
| Command fails (non-zero exit) | Returns the result with `exitCode`, `stderr`. Does not throw. |
| File not found on read | Throws an error. Generator retry can handle transient cases. |
| Sandbox provider unavailable | Throws on `createBashTool()` call. |
| Upstash adapter selected | Throws — placeholder until FIX-314 ships. |
| `just-bash` not installed | Falls back to in-memory Map-based sandbox. |

## Next steps

- [Tools overview](/docs/tools/overview) — all available tools
- [Resources](/docs/resources/overview) — resource system fundamentals
- [Collections](/docs/resources/collections) — resource collection patterns
