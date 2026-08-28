/**
 * `createBashTool` — main entry point for the bash tool system.
 *
 * Creates a set of AI SDK tools (`bash`, `readFile`, `writeFile`) backed by
 * a sandbox and bidirectionally synced with framework resource collections.
 *
 * Usage inside a handler's `execute`:
 * ```ts
 * const { tools, sandbox } = await createBashTool({
 *   collections: { files: ctx.resources.files },
 *   provider: { type: "local", cwd: "./workspace" },
 * });
 * ```
 *
 * The returned `tools` are AI SDK tool objects. Pass them to a generator
 * via `providerTools`:
 * ```ts
 * providerTools: [
 *   providerTool("bash", tools.bash),
 *   providerTool("readFile", tools.readFile),
 *   providerTool("writeFile", tools.writeFile),
 * ]
 * ```
 */

import { z } from "zod";
import { tool } from "ai";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type {
  Sandbox,
  SandboxProvider,
  FileEntryState,
  BashSessionState,
  CreateBashToolOptions,
  CreateBashToolResult,
} from "./types";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import { unscopedCollectionId } from "@flow-state-dev/workspace";
import {
  createBashProjection,
  flushWithDiagnostics,
  seedWorkspaceMarkers,
  warnUnsettled,
  type BashMount,
} from "./projection-setup";
import { resolveSandbox } from "./resolve-sandbox";

// All other adapters (just-bash, Vercel, Upstash) are loaded dynamically
// in resolveSandbox() to avoid bundlers like Turbopack tracing into
// peer dependencies that may not be installed.

/**
 * Creates bash, readFile, and writeFile tools backed by a sandbox environment.
 *
 * Files are bidirectionally synced between the passed resource collections and
 * the sandbox filesystem. On init, resources are hydrated into the sandbox.
 * After every `bash` and `writeFile` call, changes are flushed back to resources.
 *
 * @returns AI SDK tool objects and the resolved sandbox instance.
 */
export async function createBashTool(
  options: CreateBashToolOptions = {},
): Promise<CreateBashToolResult> {
  const {
    collections = {},
    bashSession,
    provider = { type: "just-bash" },
    destination = "/workspace",
    persist = false,
    onBeforeCommand,
    onAfterCommand,
  } = options;

  // `scope` has no meaning here and cannot be given one. It picks a workspace
  // per run, per session, per user or per org, and every one of those is read
  // off a block's execution context — which this factory does not have, and
  // does not get: it returns plain AI SDK tools, not blocks. Accepting it
  // silently would hand back one shared directory while the configuration said
  // several isolated ones.
  if (provider.type === "local" && provider.scope !== undefined) {
    throw new Error(
      `[bash] \`scope: "${provider.scope}"\` is not available from createBashTool — the ` +
        `identity it scopes by lives on a block's context, and these are plain tools. Pass ` +
        `\`cwd\` to choose the workspace directory, or use createBashBlocks for a scoped one.`,
    );
  }

  // 1. Resolve or create sandbox
  const existingId = persist && bashSession ? bashSession.state.sandboxId || undefined : undefined;
  const { sandbox, sandboxId } = await resolveSandbox(provider, { destination, existingId });

  // 2. Mount every collection at its pattern prefix and project it into the
  //    sandbox. A collection whose pattern has no prefix cannot be routed to
  //    without guessing, so it is skipped loudly rather than made the default
  //    owner of every loose file.
  const mounts: BashMount[] = [];
  for (const [name, collection] of Object.entries(collections)) {
    const prefix = getPatternPrefix(collection.pattern);
    if (!prefix) {
      console.warn(
        `[bash] collection "${name}" has pattern "${collection.pattern}", which gives no directory to mount it at — skipped.`,
      );
      continue;
    }
    mounts.push({
      prefix,
      collection,
      // No execution context here, so no scope instance to name — see
      // `unscopedCollectionId` for why that resolves toward arbitrating.
      collectionId: unscopedCollectionId(collection),
      writable: true,
    });
  }
  const projection = createBashProjection(sandbox, destination, mounts);

  // 3. Hydrate: resources → sandbox. The markers go down FIRST, so an empty
  // collection still has a directory for the flush walk to find — without
  // them, `find` against a never-created prefix exits non-zero and takes an
  // otherwise successful command down with it.
  await seedWorkspaceMarkers(sandbox, destination, mounts);
  await projection.hydrate();

  // 4. Build file listing for LLM context.
  //
  // Built from the MOUNT, not from `state.path`. A collection matching
  // `files/*` is mounted at `files/`, so its `hello.txt` lives at
  // `files/hello.txt` — advertising the bare key would point the model at a
  // path that does not exist. Collections skipped above are absent for the
  // same reason: nothing was laid down for them.
  const listed = await Promise.all(
    mounts.map(async (mount) => {
      const refs = await (
        mount.collection as unknown as ResourceCollectionRef<FileEntryState>
      ).list();
      return refs.map((ref) => {
        const key = ref.state.path ?? "";
        return key.startsWith(`${mount.prefix}/`) ? key : `${mount.prefix}/${key}`;
      });
    }),
  );
  const fileList = listed.flat().join("\n");

  // 5. Construct AI SDK tools
  const tools = {
    bash: tool({
      description: [
        "Execute a bash command in the workspace.",
        `Working directory: ${destination}`,
        fileList ? `Available files:\n${fileList}` : "No files yet.",
      ].join("\n"),
      inputSchema: z.object({
        command: z.string().describe("The bash command to execute"),
      }),
      execute: async ({ command }) => {
        let cmd = command;
        if (onBeforeCommand) {
          const modified = onBeforeCommand(cmd);
          if (typeof modified === "string") cmd = modified;
        }

        const result = await sandbox.executeCommand(cmd);
        // Read, not discarded, and never allowed to throw: a refused write
        // that nothing mentions is a write the caller believes landed, and a
        // failed walk must not fail a command that succeeded.
        await flushWithDiagnostics(projection, mounts, sandbox.hostMountSource);

        if (onAfterCommand) {
          const modified = onAfterCommand(cmd, result);
          if (modified) return modified;
        }

        return result;
      },
    }),

    readFile: tool({
      description: "Read the contents of a file from the workspace.",
      inputSchema: z.object({
        path: z.string().describe("Path to the file to read, relative to workspace root"),
      }),
      execute: async ({ path: filePath }) => {
        const fullPath = `${destination}/${filePath}`;
        const content = await sandbox.readFile(fullPath);
        return { content };
      },
    }),

    writeFile: tool({
      description: "Write content to a file in the workspace. Creates parent directories if needed.",
      inputSchema: z.object({
        path: z.string().describe("Path where the file should be written, relative to workspace root"),
        content: z.string().describe("Content to write to the file"),
      }),
      execute: async ({ path: filePath, content }) => {
        const fullPath = `${destination}/${filePath}`;
        await sandbox.writeFile(fullPath, content);
        const outcome = await projection.put(filePath, content);
        if (outcome !== undefined) warnUnsettled([outcome]);
        return { success: true };
      },
    }),
  };

  // 6. Persist sandbox ID if requested
  if (persist && sandboxId && bashSession) {
    await bashSession.setState({
      sandboxId,
      provider: provider.type,
      lastSyncedAt: new Date().toISOString(),
      workingDirectory: destination,
    });
  }

  return { tools, sandbox };
}

