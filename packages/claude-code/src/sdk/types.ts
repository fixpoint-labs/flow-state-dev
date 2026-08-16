/**
 * Type contracts for the in-process Agent SDK path (`./sdk`).
 *
 * Holds the source-specific handle (`SdkAgentHandle`) returned by the agent
 * block, a structural subset of the SDK's streamed message shape
 * (`SdkMessageLike`) so this package never type-depends on the optional SDK,
 * the pure translation layer's output union (`TranslatedEvent`), and the
 * option/resolution interfaces shared across the path.
 */
import { z } from "zod";
import type { BlockContext } from "@flow-state-dev/core/types";
import { remoteAgentTaskHandleSchema, type RemoteAgentTaskHandle } from "../shared/handle";

/** Terminal result subtype reported by the SDK's `result` message. */
export type SdkResultSubtype =
  | "success"
  | "error_max_turns"
  | "error_max_budget_usd"
  | "error_during_execution"
  | "error_max_structured_output_retries";

/**
 * Handle for a single in-process Agent SDK run.
 *
 * Unlike the fire-and-forget CLI handle, the SDK path observes the run to
 * completion, so `status` reaches `"completed"`/`"errored"` and the handle
 * carries the final assistant text, the tools the SDK exercised, and usage/cost
 * when the SDK reported them. Usage and cost are `null` when the SDK result
 * omitted them — values are never invented.
 */
export interface SdkAgentHandle extends RemoteAgentTaskHandle {
  source: "sdk";
  status: "running" | "completed" | "errored";
  /**
   * The SDK's terminal `result.subtype`, or `null` if the run never produced
   * one. Reported as the SDK gave it, which is not a verdict: a run the SDK
   * flagged with `is_error` carries `resultSubtype: "success"` on a handle whose
   * `status` is `"errored"`. Read `status`.
   */
  resultSubtype: SdkResultSubtype | null;
  /** The last assistant message text, or `null` if the run produced none. */
  finalMessage: string | null;
  /** Distinct SDK tool names observed during the run, in first-seen order. */
  toolsObserved: string[];
  /** Token usage from the SDK result, or `null` when unreported. */
  usage: { inputTokens: number; outputTokens: number } | null;
  /** Total cost in USD from the SDK result, or `null` when unreported. */
  costUsd: number | null;
}

/** Runtime validator for {@link SdkAgentHandle}. */
export const sdkAgentHandleSchema = remoteAgentTaskHandleSchema.extend({
  source: z.literal("sdk"),
  status: z.enum(["running", "completed", "errored"]),
  resultSubtype: z
    .enum([
      "success",
      "error_max_turns",
      "error_max_budget_usd",
      "error_during_execution",
      "error_max_structured_output_retries",
    ])
    .nullable(),
  finalMessage: z.string().nullable(),
  toolsObserved: z.array(z.string()),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
  costUsd: z.number().nullable(),
});

/**
 * Structural subset of the SDK's `SDKMessage` union — only the fields this
 * package reads. Declared locally so `./sdk` never statically imports the SDK's
 * types (the SDK is an optional peer dependency). Discriminated by `type`.
 */
export type SdkMessageLike =
  | {
      type: "system";
      subtype?: "init" | "compact_boundary" | string;
      session_id?: string;
    }
  | {
      type: "assistant";
      session_id?: string;
      /**
       * The container tool-use id when this message was produced inside a
       * sub-agent (`Task`/`Agent`) loop; `null`/absent at the top level. Used to
       * nest the sub-agent's own assistant/tool items under its container.
       */
      parent_tool_use_id?: string | null;
      message?: {
        content?: Array<
          | { type: "text"; text: string }
          | { type: "thinking"; thinking: string }
          | { type: "tool_use"; id: string; name: string; input?: unknown }
        >;
      };
    }
  | {
      type: "user";
      session_id?: string;
      parent_tool_use_id?: string | null;
      message?: {
        content?: Array<{
          type: "tool_result";
          tool_use_id: string;
          content?: unknown;
          is_error?: boolean;
        }>;
      };
    }
  | {
      type: "stream_event";
      session_id?: string;
      parent_tool_use_id?: string | null;
      event?: {
        type?: string;
        delta?: {
          type?: "text_delta" | "thinking_delta" | "input_json_delta" | string;
          /** Present on a `text_delta` (Anthropic raw-stream contract). */
          text?: string;
          /** Present on a `thinking_delta` — NOT `text`. */
          thinking?: string;
          /** Present on an `input_json_delta` (streamed tool arguments). */
          partial_json?: string;
        };
      };
    }
  | {
      type: "result";
      subtype?: SdkResultSubtype | string;
      /** Present only on the `success` result variant. */
      result?: string;
      /** Present only on error-subtype results (replaces `result`). */
      errors?: string[];
      /**
       * The SDK's own error flag. Present on both result variants, and set on a
       * success-subtype result whose run nonetheless went wrong — so it is read
       * alongside `subtype`, not instead of it.
       */
      is_error?: boolean;
      /**
       * Every tool call the run asked to make and did not get, in the SDK's own
       * spelling. The SDK records one here for any permission decision that was
       * not `allow` — an explicit deny, and an `ask` no one could answer — so it
       * is the only place an unattended caller can learn that the agent was
       * *refused* rather than that it tried and failed. Absent on an SDK version
       * that predates the field; empty on a run that was refused nothing.
       */
      permission_denials?: Array<{
        tool_name?: string;
        tool_use_id?: string;
        tool_input?: Record<string, unknown>;
      }>;
      session_id?: string;
      /** `NonNullableUsage` carries `input_tokens`/`output_tokens` (+ cache). */
      usage?: { input_tokens?: number; output_tokens?: number } | null;
      total_cost_usd?: number | null;
    };

/**
 * A normalized event produced by the pure translation layer. Each variant maps
 * to one or more canonical FSD item emissions in `emit.ts`. The union is the
 * stable contract between `translate.ts` (pure) and `emit.ts` (ctx-driven).
 */
export type TranslatedEvent =
  /**
   * A streamed token of assistant text (partial-message path). `parentCallId`
   * (when set) is the sub-agent container this streamed turn belongs to.
   */
  | { kind: "message_delta"; text: string; parentCallId?: string }
  /**
   * A complete assistant message block (whole-message path). When partials are
   * ON this fires only as a close boundary; `parentCallId` (when set) is the
   * sub-agent container this turn belongs to.
   */
  | { kind: "message_complete"; text: string; parentCallId?: string }
  /**
   * A streamed token of reasoning text (partial-message path). `parentCallId`
   * (when set) is the sub-agent container this streamed turn belongs to.
   */
  | { kind: "reasoning_delta"; text: string; parentCallId?: string }
  /** A complete reasoning block (whole-message path). */
  | { kind: "reasoning_complete"; text: string; parentCallId?: string }
  /**
   * The SDK requested a tool. `callId` correlates with the eventual result;
   * `parentCallId` (when set) is the sub-agent container that owns this tool.
   */
  | { kind: "tool_call"; callId: string; name: string; arguments: string; parentCallId?: string }
  /** A tool finished. `callId` correlates with its opening `tool_call`. */
  | {
      kind: "tool_result";
      callId: string;
      output: unknown;
      isError: boolean;
      parentCallId?: string;
    }
  /** A sub-agent (`Agent`/`Task`) spawned. `callId` is its tool_use id. */
  | { kind: "subagent_open"; callId: string; name: string }
  /** A sub-agent finished. `callId` matches its `subagent_open`. */
  | { kind: "subagent_close"; callId: string; output: unknown; isError: boolean }
  /** A transient system/lifecycle notice (init, compaction). */
  | { kind: "status"; message: string }
  /** A terminal error outcome from the SDK result. */
  | { kind: "error"; message: string; code?: string }
  /** The SDK's terminal result, carrying session id, usage, and cost. */
  | {
      kind: "result";
      subtype: SdkResultSubtype | null;
      /**
       * Whether the run succeeded — the whole verdict, already accounting for
       * the SDK's `is_error` flag as well as the subtype. Read this, not
       * `subtype`: a run the SDK flagged reports `subtype: "success"` and
       * `succeeded: false`.
       */
      succeeded: boolean;
      finalMessage: string | null;
      sessionId: string | null;
      usage: { inputTokens: number; outputTokens: number } | null;
      costUsd: number | null;
    };

/** What a {@link ResolveClaudeAgent} returns: the SDK's `query` entry point. */
export interface ResolvedClaudeAgent {
  query: ClaudeAgentQuery;
}

/**
 * What `query()` hands back: the run's message stream, plus the SDK's own
 * teardown if this version has one.
 *
 * The SDK's `Query` is an `AsyncGenerator` carrying control methods, of which
 * `close()` is the one a caller that stops reading needs — aborting the signal
 * asks the run to stop, `close()` tears the underlying agent down. It is
 * declared optional and structural for the same reason the rest of this file
 * is: the package never type-depends on the optional SDK, a scripted fake
 * satisfies the shape without it, and an older SDK that lacks it still type-checks.
 */
export interface ClaudeAgentStream extends AsyncIterable<SdkMessageLike> {
  /** Stop the underlying run and release its process. Absent on a bare iterable. */
  close?: () => void;
}

/**
 * The SDK `query()` function shape this package calls. Structural so a scripted
 * fake satisfies it in tests without importing the SDK. Returns a
 * {@link ClaudeAgentStream}.
 */
export type ClaudeAgentQuery = (args: {
  prompt: string | AsyncIterable<unknown>;
  options?: ClaudeAgentQueryOptions;
}) => ClaudeAgentStream;

/**
 * Where the SDK may load filesystem settings from — the SDK's `SettingSource`.
 *
 * This is the option that decides whether a run sees the project it is pointed
 * at. The SDK loads **none** of these unless asked (its isolation mode), so a
 * run that should behave like `claude` in a checkout has to name them; `project`
 * in particular is what loads `CLAUDE.md`.
 */
export type ClaudeSettingSource = "user" | "project" | "local";

/**
 * The Claude Code system prompt, as the SDK models it. A bare string replaces
 * it; the preset object keeps Claude Code's own prompt (optionally appending to
 * it). Omitting the field entirely gives an **empty** system prompt — the SDK's
 * isolation default, not Claude Code's behaviour.
 */
export type ClaudeSystemPrompt =
  | string
  | { type: "preset"; preset: "claude_code"; append?: string };

/** Options forwarded to the SDK `query()` call. Loosely typed by design. */
export interface ClaudeAgentQueryOptions {
  model?: string;
  systemPrompt?: ClaudeSystemPrompt;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  /** Required by the SDK alongside `permissionMode: "bypassPermissions"`. */
  allowDangerouslySkipPermissions?: boolean;
  canUseTool?: SdkCanUseTool;
  agents?: unknown;
  maxTurns?: number;
  /** Vendor-side spend ceiling; the run stops with `error_max_budget_usd`. */
  maxBudgetUsd?: number;
  resume?: string;
  includePartialMessages?: boolean;
  /** Directory the run reads and writes. Defaults to the host process's cwd. */
  cwd?: string;
  /** Environment for the agent process. Defaults to the host process's env. */
  env?: Record<string, string | undefined>;
  /** Filesystem settings to load. See {@link ClaudeSettingSource}. */
  settingSources?: readonly ClaudeSettingSource[];
  /** Forwarded to the SDK so an aborted `ctx.signal` stops the run. */
  abortController?: AbortController;
}

/** The SDK's `canUseTool` callback shape (HITL seam target). */
export type SdkCanUseTool = (
  toolName: string,
  input: unknown,
  extra: { signal?: AbortSignal; suggestions?: unknown },
) => Promise<SdkToolDecision>;

/** A tool-approval decision in the SDK's `canUseTool` vocabulary. */
export type SdkToolDecision =
  | { behavior: "allow"; updatedInput: unknown }
  | { behavior: "deny"; message: string };

/**
 * Host hook resolving the SDK `query` for a given block invocation. Accepts the
 * block context loosely so a fully parameterized `execute` context passes
 * without a cast at the call site.
 */
export type ResolveClaudeAgent = (
  ctx: BlockContext<any>,
) => ResolvedClaudeAgent | Promise<ResolvedClaudeAgent>;

/**
 * The same hook without a block context, for callers that have none.
 *
 * {@link ResolveClaudeAgent} takes a `ctx` because it is a block-level seam; the
 * resolution itself never reads one. A non-flow caller (`runClaudeHeadless`)
 * uses this shape so it has nothing to invent, and the two share one
 * implementation in `sdk-client.ts`.
 */
export type ResolveClaudeAgentQuery = () =>
  | ResolvedClaudeAgent
  | Promise<ResolvedClaudeAgent>;

/** An approval request handed to {@link ClaudeCodeAgentOptions.onToolApproval}. */
export interface ToolApprovalRequest {
  toolName: string;
  input: unknown;
  /**
   * The SDK's per-call abort signal (`extra.signal` from `canUseTool`), when
   * present. A host UI can observe it to cancel a pending approval prompt.
   */
  signal?: AbortSignal;
}

/** A decision returned by {@link ClaudeCodeAgentOptions.onToolApproval}. */
export type ToolApprovalDecision =
  | { decision: "allow"; updatedInput?: unknown }
  | { decision: "deny"; message?: string };
