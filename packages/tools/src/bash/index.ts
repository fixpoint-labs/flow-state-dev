/**
 * Bash tool — resource-backed filesystem with sandbox adapters.
 *
 * Bridges the framework's resource system with actual filesystems (local or
 * cloud sandboxes). Files live as resources for persistence and portability;
 * they're materialized into a real filesystem for bash execution, then synced
 * back after mutations.
 *
 * Entry point: `createBashTool(options)` returns AI SDK tools for
 * `bash`, `readFile`, and `writeFile`.
 *
 * @example
 * ```ts
 * import { createBashTool } from "@flow-state-dev/tools/bash";
 *
 * const { tools, sandbox } = await createBashTool({
 *   collections: { files: ctx.session.resources.files },
 *   provider: { type: "local", cwd: "./workspace" },
 * });
 * ```
 */

export { createBashTool } from "./create-bash-tool";
export { FileSync } from "./file-sync";
export { hashContent } from "./hash";

// Adapters
export { createLocalFsSandbox } from "./adapters/local-fs";
export { createVercelAdapter, resolveVercelSandbox } from "./adapters/vercel";
export { createUpstashAdapter, resolveUpstashBox } from "./adapters/upstash";
export { createJustBashSandbox } from "./adapters/just-bash";

// Types
export type {
  Sandbox,
  CommandResult,
  FileEntryState,
  SandboxProvider,
  BashSessionState,
  CreateBashToolOptions,
  CreateBashToolResult,
  BashToolkit,
} from "./types";
export type { UpstashBoxClient } from "./adapters/upstash";
