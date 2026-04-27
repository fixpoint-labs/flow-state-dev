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
import { FileSync } from "./file-sync";
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
    syncMode = "diff",
    onBeforeCommand,
    onAfterCommand,
    fileFilter,
  } = options;

  // 1. Resolve or create sandbox
  const existingId = persist && bashSession ? bashSession.state.sandboxId || undefined : undefined;
  const { sandbox, sandboxId } = await resolveSandbox(provider, { destination, existingId });

  // 2. Create sync bridge
  const sync = new FileSync(sandbox, collections, {
    destination,
    syncMode,
    fileFilter,
  });

  // 3. Hydrate: resources → sandbox
  await sync.hydrate();

  // 4. Build file listing for LLM context
  const allFiles = Object.values(collections)
    .flatMap((c: ResourceCollectionRef<FileEntryState>) => c.list())
    .map((ref) => ref.state.path);
  const fileList = allFiles.join("\n");

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
        await sync.flush();

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
        await sync.flush();
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

