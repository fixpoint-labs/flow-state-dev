/**
 * Core types for the bash tool system.
 *
 * The bash tool bridges the framework's resource system with actual filesystems
 * (local or cloud sandboxes). Files live as resources for persistence and
 * portability; they're materialized into a real filesystem for bash execution,
 * then synced back after mutations.
 */

import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";

// ---------------------------------------------------------------------------
// Sandbox interface
// ---------------------------------------------------------------------------

/** Result of executing a bash command in a sandbox. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Sandbox interface — the execution seam.
 *
 * Matches the Vercel bash-tool Sandbox contract for compatibility. Every
 * adapter (local fs, Vercel, Upstash, just-bash) implements this interface.
 * Swapping adapters requires no changes to tool logic.
 */
export interface Sandbox {
  executeCommand(command: string): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  stop?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// File entry (resource state)
// ---------------------------------------------------------------------------

/**
 * Metadata stored on each file resource instance.
 *
 * File content lives in the resource content field (`readContent`/`writeContent`),
 * not in state. State tracks path, content hash, and last-sync timestamp.
 *
 * Uses a type alias (not interface) so it satisfies the `JsonObject` index
 * signature constraint required by `ResourceCollectionRef`.
 */
export type FileEntryState = {
  /** Path relative to workspace root (e.g. "src/index.ts"). */
  path: string;
  /** Content hash for diffing during flush. */
  hash: string;
  /** ISO timestamp of last sync. */
  updatedAt: string;
  [key: string]: string;
};

// ---------------------------------------------------------------------------
// Sandbox provider
// ---------------------------------------------------------------------------

/** Discriminated union of sandbox provider configurations. */
export type SandboxProvider =
  | { type: "local"; cwd?: string }
  | { type: "vercel"; sandboxId?: string }
  | { type: "upstash"; boxId?: string }
  | { type: "just-bash" }
  | { type: "custom"; sandbox: Sandbox };

// ---------------------------------------------------------------------------
// Bash session state (singleton resource)
// ---------------------------------------------------------------------------

/** State stored in the `bash:session` singleton resource for sandbox persistence. */
export type BashSessionState = {
  sandboxId: string;
  provider: string;
  lastSyncedAt: string;
  workingDirectory: string;
  [key: string]: string;
};

// ---------------------------------------------------------------------------
// Tool options
// ---------------------------------------------------------------------------

/**
 * Configuration for `createBashTool()`.
 *
 * `collections` maps friendly names to runtime `ResourceCollectionRef` handles.
 * Only the collections you pass are synced to the workspace — nothing else
 * is accessible to the bash tool.
 */
export interface CreateBashToolOptions {
  /**
   * Resource collections to sync into the workspace.
   * Keys are collection names; values are runtime refs from the block context.
   * Only collections explicitly passed here are materialized as files.
   */
  collections?: Record<string, ResourceCollectionRef<FileEntryState>>;

  /**
   * Optional singleton resource ref for persisting sandbox state across sessions.
   * Pass `ctx.session.resources.bashSession` (or equivalent) to enable persistence.
   */
  bashSession?: ResourceRef<BashSessionState>;

  /** Sandbox provider. Default: `{ type: "just-bash" }`. */
  provider?: SandboxProvider;

  /** Workspace root inside the sandbox. Default: `"/workspace"`. */
  destination?: string;

  /** Persist sandbox across sessions via the `bashSession` resource. Default: `false`. */
  persist?: boolean;

  /** Sync strategy: `"full"` re-reads everything; `"diff"` uses content hashing. Default: `"diff"`. */
  syncMode?: "full" | "diff";

  /** Hook called before every bash command. Return a string to rewrite the command. */
  onBeforeCommand?: (cmd: string) => string | void;

  /** Hook called after every bash command. Return a `CommandResult` to override the result. */
  onAfterCommand?: (cmd: string, result: CommandResult) => CommandResult | void;

  /** Filter which workspace files are synced back to resources. Return `false` to skip a path. */
  fileFilter?: (path: string) => boolean;
}

// ---------------------------------------------------------------------------
// Tool output
// ---------------------------------------------------------------------------

/** The toolkit returned by `createBashTool()`. */
export interface BashToolkit {
  bash: unknown;
  readFile: unknown;
  writeFile: unknown;
}

/** Return value of `createBashTool()`. */
export interface CreateBashToolResult {
  /** AI SDK tool definitions for bash, readFile, and writeFile. */
  tools: BashToolkit;
  /** The resolved sandbox instance (for direct access if needed). */
  sandbox: Sandbox;
}
