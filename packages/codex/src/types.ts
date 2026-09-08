/**
 * Type contracts for `@flow-state-dev/codex`.
 *
 * Three groups live here:
 *
 * - The **handle** this package returns — the framework's neutral
 *   {@link HarnessRunHandle} plus the two things only Codex reports (its full
 *   usage breakdown, and the message of a turn the model failed).
 * - A **local declaration of the SDK's wire** — the `ThreadEvent` union and the
 *   `ThreadItem` kinds `codex exec --experimental-json` emits. Declared here
 *   rather than imported so this package never type-depends on the optional
 *   peer, exactly as `claude-code/sdk/types.ts` does for the Agent SDK. The
 *   declarations mirror `@openai/codex-sdk` {@link TESTED_SDK_VERSION}; the
 *   version gate is what keeps them true (see `./codex-client`).
 * - The **seam types** the block calls the SDK through, so a scripted client
 *   satisfies them in tests with no subprocess.
 *
 * Nothing Codex-specific leaves this package: the manager reads the neutral
 * fields (tenet 4).
 */
import { z } from "zod";
import { harnessRunHandleSchema } from "@flow-state-dev/core";
import type { BlockContext, HarnessRunHandle } from "@flow-state-dev/core/types";

/**
 * This harness's `<package>/<door>` name — the convention every writer of a
 * harness handle's `source` owes (LAB-152). The suffix names the door we drive
 * Codex through, and this package has exactly one: OpenAI's own SDK.
 */
export const CODEX_SOURCE = "codex/sdk" as const;

/**
 * The one `@openai/codex-sdk` version this package has been tested against.
 *
 * The JSONL wire the SDK speaks sits behind the CLI's `--experimental-json`
 * flag and can change in a lockstep CLI+SDK release, so a Codex upgrade is a
 * deliberate, tested bump of ours rather than something a host can take on its
 * own. `codexAgent` refuses to build against any other installed version, and
 * the escape is a release of this package — there is no override option.
 */
export const TESTED_SDK_VERSION = "0.152.1" as const;

/**
 * Codex's full token breakdown for a turn.
 *
 * The neutral handle carries only `inputTokens`/`outputTokens`, which is what
 * every harness can fill honestly. The rest rides here so a consumer that wants
 * to price a run differently — or read what the cache actually saved — has the
 * raw numbers rather than our derivation of them.
 *
 * `reasoningOutputTokens` is a SUBSET of `outputTokens`, as OpenAI's usage
 * reports it. Adding the two would double-count the reasoning.
 */
export interface CodexRunUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

/**
 * Handle for a single Codex run.
 *
 * The neutral harness handle plus Codex's own extras. `status` never reaches
 * `"dispatched"`/`"running"`: this door observes its run to completion or
 * throws, so a returned handle is always terminal.
 *
 * `outcome` is `"finished"` on a completed turn and `"failed"` on a failed one.
 * Codex reports no turn or budget cap, so `"stopped-at-limit"` is never
 * produced here — a run stopped by the CALLER's deadline is a throw, not a
 * handle (LAB-152's abort contract).
 */
export interface CodexAgentHandle extends HarnessRunHandle {
  source: typeof CODEX_SOURCE;
  status: "completed" | "errored";
  /** Codex's own usage breakdown, or `null` when no `turn.completed` arrived. */
  codexUsage: CodexRunUsage | null;
  /** The message from a `turn.failed` event, or `null` when the turn did not fail. */
  failureMessage: string | null;
}

/**
 * Runtime validator for {@link CodexAgentHandle}.
 *
 * The extension's own two fields default to `null` for the same reason the
 * neutral schema's four do: a handle persisted before they existed still parses
 * (BP-030).
 */
export const codexAgentHandleSchema = harnessRunHandleSchema.extend({
  source: z.literal(CODEX_SOURCE),
  status: z.enum(["completed", "errored"]),
  codexUsage: z
    .object({
      inputTokens: z.number(),
      cachedInputTokens: z.number(),
      cacheWriteInputTokens: z.number(),
      outputTokens: z.number(),
      reasoningOutputTokens: z.number(),
    })
    .nullable()
    .default(null),
  failureMessage: z.string().nullable().default(null),
});

// ---------------------------------------------------------------------------
// The SDK's wire, declared locally
// ---------------------------------------------------------------------------

/** A file the run's patch touched, and how. */
export interface CodexFileUpdateChange {
  path: string;
  kind: "add" | "delete" | "update";
}

/**
 * One item in a Codex thread.
 *
 * Eight kinds on the tested wire. Every field this package READS is optional
 * or guarded at the point of use even inside a kind we recognise: the version
 * gate holds the boundary, but a vendor moving a field WITHIN an event it still
 * calls `item.completed` would otherwise crash translation on a wire the gate
 * had already approved.
 */
export type CodexThreadItem =
  | { id: string; type: "agent_message"; text: string }
  | { id: string; type: "reasoning"; text: string }
  | {
      id: string;
      type: "command_execution";
      command: string;
      aggregated_output: string;
      exit_code?: number;
      status: "in_progress" | "completed" | "failed";
    }
  | {
      id: string;
      type: "file_change";
      changes: CodexFileUpdateChange[];
      status: "completed" | "failed";
    }
  | {
      id: string;
      type: "mcp_tool_call";
      server: string;
      tool: string;
      arguments: unknown;
      result?: unknown;
      error?: { message: string };
      status: "in_progress" | "completed" | "failed";
    }
  | { id: string; type: "web_search"; query: string }
  | { id: string; type: "todo_list"; items: Array<{ text: string; completed: boolean }> }
  | { id: string; type: "error"; message: string }
  // Anything the tested wire gains that this package does not know. Kept in the
  // union so translation has a branch to fall into rather than a cast (BP-030).
  | { id: string; type: string };

/** Codex's per-turn token report, in the wire's own snake_case spelling. */
export interface CodexWireUsage {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}

/** A top-level JSONL event from `codex exec --experimental-json`. */
export type CodexThreadEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage: CodexWireUsage }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "item.started"; item: CodexThreadItem }
  | { type: "item.updated"; item: CodexThreadItem }
  | { type: "item.completed"; item: CodexThreadItem }
  | { type: "error"; message: string }
  // Same reason as the item union's open branch.
  | { type: string };

// ---------------------------------------------------------------------------
// Forwarded option groups
// ---------------------------------------------------------------------------

/**
 * The SDK's `ThreadOptions`, forwarded verbatim and typed locally.
 *
 * `workingDirectory` is deliberately ABSENT: the `cwd` resolver owns it, and
 * passing one here is refused when the block is built rather than merged
 * (BP-031 — one owner). The refusal is a runtime check, because a caller
 * spreading an untyped bag would otherwise slip past the type.
 */
export interface CodexThreadOptions {
  model?: string;
  threadSource?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?:
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max"
    | "ultra"
    | "persistent";
  networkAccessEnabled?: boolean;
  webSearchMode?: "disabled" | "cached" | "live";
  webSearchEnabled?: boolean;
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  additionalDirectories?: string[];
}

/**
 * The SDK's `CodexOptions`, forwarded verbatim to the client constructor.
 *
 * `env` REPLACES the CLI process's environment rather than adding to it — the
 * SDK's own rule. Spread `process.env` to add, exactly as the Claude Code
 * adapter documents for its own `env`.
 */
export interface CodexClientOptions {
  codexPathOverride?: string;
  baseUrl?: string;
  apiKey?: string;
  config?: Record<string, unknown>;
  configOverrides?: string[];
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// The resolver seam
// ---------------------------------------------------------------------------

/** The subset of the SDK's `Thread` this package drives. */
export interface CodexThreadLike {
  /** Populated once the first turn names the thread; `null` before that. */
  readonly id: string | null;
  runStreamed(
    input: string,
    turnOptions?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncIterable<CodexThreadEvent> }>;
}

/** The subset of the SDK's `Codex` client this package drives. */
export interface ResolvedCodexClient {
  startThread(options?: CodexThreadOptions & { workingDirectory?: string }): CodexThreadLike;
  resumeThread(
    id: string,
    options?: CodexThreadOptions & { workingDirectory?: string },
  ): CodexThreadLike;
}

/**
 * Host hook resolving the Codex client for a block invocation.
 *
 * Accepts the block context loosely so a fully parameterized `execute` context
 * passes without a cast — the same reason `ResolveClaudeAgent` does.
 */
export type ResolveCodexClient = (
  ctx: BlockContext<any, any, any, any, any, any, any, any, any>,
) => ResolvedCodexClient | Promise<ResolvedCodexClient>;

/**
 * What the version gate could learn about the installed SDK.
 *
 * Three answers, not two, and the third is the one that matters. `absent` and
 * `unreadable` both used to be `null`, and the gate PASSED on `null` — so a
 * layout the manifest walk cannot see (Yarn PnP, a custom loader) let an
 * unvalidated SDK through a gate whose whole purpose is to refuse one, while the
 * dynamic import went on resolving and running it. A safety gate must fail
 * closed: "there is nothing installed" is safe, "I cannot tell" is not.
 */
export type InstalledSdkVersion =
  | { kind: "absent" }
  | { kind: "version"; version: string }
  | { kind: "unreadable"; reason: string };

/**
 * How the version gate learns which SDK is installed.
 *
 * A seam only so the refusal is testable against versions other than the one on
 * this disk. It is deliberately NOT reachable from `CodexAgentOptions`: a host
 * that could substitute its own reader could answer with the tested version and
 * run an unvalidated wire, which would make the package's exact-version refusal
 * a claim rather than a guarantee.
 */
export type InstalledSdkVersionReader = () => InstalledSdkVersion;

// ---------------------------------------------------------------------------
// The pure translation layer's output
// ---------------------------------------------------------------------------

/**
 * What `translate` turns one wire event into: a description of what to emit,
 * with no side effects and no vendor vocabulary past this point.
 *
 * `thread_started` is not an emission — it carries the id to the host's session
 * hook — but it rides the same union so the block's loop has one shape to walk.
 */
export type TranslatedEvent =
  | { kind: "thread_started"; threadId: string }
  | { kind: "message"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool_call"; callId: string; name: string; arguments: string }
  | {
      kind: "tool_result";
      callId: string;
      name: string;
      arguments: string;
      output: unknown;
      isError: boolean;
    }
  | { kind: "status"; message: string }
  | { kind: "error"; message: string; code?: string }
  | { kind: "turn_completed"; usage: CodexRunUsage | null }
  | { kind: "turn_failed"; message: string };
