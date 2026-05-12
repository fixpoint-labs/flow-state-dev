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

/** Network configuration for just-bash sandboxes. */
export type NetworkConfig = {
  /** Bypass all URL restrictions. Use only in trusted environments. */
  dangerouslyAllowFullInternetAccess?: boolean;
  /** Allowlisted URL prefixes with optional method and header constraints. */
  allowedUrls?: Array<{
    url: string;
    methods?: string[];
    headers?: Record<string, string>;
  }>;
};

/** Execution limits for just-bash sandboxes. */
export type ExecutionLimits = {
  maxCallDepth?: number;
  maxCommandCount?: number;
  maxLoopIterations?: number;
  maxAwkIterations?: number;
  maxSedIterations?: number;
};

/** Workspace scope for the local provider. Determines the workspace directory. */
export type WorkspaceScope = "session" | "user" | "org";

// ---------------------------------------------------------------------------
// Third-party SDK shapes
//
// Adapters that wrap third-party SDKs receive the SDK from the consumer
// (DI). The framework declares a structural type that matches what the
// adapter actually uses, so we don't take a peer dep on the SDK package
// itself. This keeps the framework portable, and — equally important —
// gives bundlers (webpack, nft) a real static import in the consumer's
// own code to follow when building for Vercel.
// ---------------------------------------------------------------------------

/**
 * Structural shape of a Vercel Sandbox `runCommand` result. Mirrors the
 * SDK's `CommandFinished`: synchronous `exitCode` plus async `stdout()`/
 * `stderr()` getters.
 */
export interface VercelCommandFinishedLike {
  exitCode: number | null;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

/** Structural shape of a Vercel Sandbox instance — only the methods the adapter calls. */
export interface VercelSandboxInstance {
  readonly sandboxId: string;
  runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<VercelCommandFinishedLike>;
  readFileToBuffer(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null>;
  writeFiles(
    files: Array<{ path: string; content: string | Uint8Array; mode?: number }>,
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
  stop(opts?: unknown): Promise<unknown>;
}

/** Structural shape of the Vercel `Sandbox` class — the class consumers pass via config. */
export interface VercelSandboxClassLike {
  create(options?: unknown): Promise<VercelSandboxInstance>;
  get(options: { sandboxId: string }): Promise<VercelSandboxInstance>;
}

/** Discriminated union of sandbox provider configurations. */
export type SandboxProvider =
  | {
      type: "local";
      /**
       * Explicit workspace directory. When set, `scope` is ignored.
       * When omitted, the workspace is auto-created at
       * `.fsdev/workspaces/{scope}/{scopeId}/`.
       */
      cwd?: string;
      /**
       * Scope for the auto-created workspace directory. Default: `"session"`.
       * - `"session"` — one workspace per session (isolated, ephemeral)
       * - `"user"` — shared across all sessions for a user
       * - `"org"` — shared across all sessions in an org
       */
      scope?: WorkspaceScope;
      /**
       * Enforce that all filesystem operations stay within the workspace root.
       * When `true` (default), commands and file paths are validated before
       * execution. Absolute paths outside the workspace, traversals (`../`),
       * home references (`~/`, `$HOME`), and command substitution are rejected.
       *
       * Set to `false` to disable guards. A warning is logged at initialization.
       */
      strictPaths?: boolean;
    }
  | {
      type: "vercel";
      /**
       * The `Sandbox` class from `@vercel/sandbox`. The consumer imports
       * the SDK directly and passes the class in. Keeps `@flow-state-dev/tools`
       * free of a peer dep on the SDK and gives bundlers a real static
       * import to trace — Vercel's nft can't follow magic-comment'd
       * dynamic imports through framework chunks reliably.
       *
       * Usage:
       * ```ts
       * import { Sandbox } from "@vercel/sandbox";
       * createBashCapability({ provider: { type: "vercel", Sandbox } });
       * ```
       */
      Sandbox: VercelSandboxClassLike;
      /**
       * Reconnect to an existing sandbox by ID. Omit to create a fresh one.
       * The framework returns the resolved ID alongside the sandbox so a
       * `bashSession` resource can persist it for the next request.
       */
      sandboxId?: string;
      /** Forwarded to `Sandbox.create()` when a new sandbox is provisioned. */
      createOptions?: unknown;
    }
  | {
      type: "upstash";
      /**
       * The Upstash Box client instance. As with the Vercel provider, the
       * consumer constructs the client (which knows its own auth/region)
       * and passes it in. Structural typing — see `UpstashBoxClient` in
       * `./adapters/upstash`.
       */
      client: UpstashBoxClientLike;
      /** Reconnect to an existing box by ID. Omit to provision a fresh one. */
      boxId?: string;
    }
  | {
      type: "just-bash";
      /** Environment variables available inside the sandbox. */
      env?: Record<string, string>;
      /** Network/URL allowlisting for curl. Off by default. */
      network?: NetworkConfig;
      /** Enable python3/python commands (WASM). */
      python?: boolean;
      /** Enable JS/TS execution (QuickJS WASM). */
      javascript?: boolean | { bootstrap?: string };
      /** Limits for recursion, loops, and command counts. */
      executionLimits?: ExecutionLimits;
    }
  | {
      type: "moat";
      /**
       * Host directory bind-mounted as the workspace. Defaults to the resolved cwd.
       */
      workspace?: string;
      /**
       * Bind-mount target inside the container. Defaults to `destination`
       * (which itself defaults to `/workspace`). Pass-through ensures agent
       * prompts that reference `/workspace/foo.ts` resolve correctly.
       */
      mountTarget?: string;
      /** Stable run name. Default derived from the session/scope ID. */
      runName?: string;
      /**
       * Provider names required in `moat grant list`. Adapter fails fast if
       * any are missing.
       */
      grants?: string[];
      /**
       * Outbound host whitelist. Default-deny when empty. Translated to a
       * repeated `--allow-host` argument and to `network.allow` in the
       * generated `moat.yaml`.
       */
      allowHosts?: string[];
      /** Container runtime. Default `"auto"` (MOAT picks). */
      runtime?: "auto" | "docker" | "apple";
      /** Pass `--no-sandbox` (disables gVisor under Docker). Default `false`. */
      noSandbox?: boolean;
      /**
       * Pre-authored `moat.yaml` path. When set, the adapter does not
       * generate a transient config. If the file lives outside the workspace,
       * it is copied into the workspace root before `moat run` and removed
       * on teardown.
       */
      configPath?: string;
      /** Per-`moat exec` timeout in ms. Default 60_000. */
      execTimeoutMs?: number;
      /** MOAT binary name or absolute path. Default `"moat"`. */
      bin?: string;
    }
  | { type: "custom"; sandbox: Sandbox };

/**
 * Structural shape of the Upstash Box client — only the methods the adapter
 * calls. Same DI rationale as `VercelSandboxClassLike`. Re-exported from
 * `./adapters/upstash` as `UpstashBoxClient` for the public-facing name.
 */
export interface UpstashBoxClientLike {
  id: string;
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  destroy(): Promise<void>;
}

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
   * Pass `ctx.resources.bashSession` (or equivalent) to enable persistence.
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
