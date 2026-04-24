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
export { createBashBlocks } from "./blocks";
export { createBashCapability } from "./capability";
export { FileSync } from "./file-sync";
export { hashContent } from "./hash";

// Adapters — only re-export adapters with zero external dependencies.
// Vercel, Upstash, and just-bash adapters are loaded dynamically when
// their provider is selected, so they don't appear here (avoids bundler
// tracing into unresolvable peer dependencies).
export { createLocalFsSandbox } from "./adapters/local-fs";

// Types — all types are safe to re-export (no runtime import chain)
export type {
  Sandbox,
  CommandResult,
  FileEntryState,
  SandboxProvider,
  WorkspaceScope,
  NetworkConfig,
  ExecutionLimits,
  BashSessionState,
  CreateBashToolOptions,
  CreateBashToolResult,
  BashToolkit,
} from "./types";
export type { CreateBashBlocksOptions, BashCollectionSpec } from "./blocks";
export type { CreateBashCapabilityOptions } from "./capability";
export type { UpstashBoxClient } from "./adapters/upstash";
