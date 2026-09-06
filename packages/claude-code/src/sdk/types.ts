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
import { harnessRunHandleSchema } from "@flow-state-dev/core";
import type { HarnessRunHandle, HarnessRunOutcome } from "@flow-state-dev/core/types";
import type { ObservedFileOpKind, ObservedGapKind, ObservedOutcome } from "./work-collections";

/** Terminal result subtype reported by the SDK's `result` message. */
export type SdkResultSubtype =
  | "success"
  | "error_max_turns"
  | "error_max_budget_usd"
  | "error_during_execution"
  | "error_max_structured_output_retries";

/**
 * This door's `<package>/<door>` name, the convention every writer of a harness
 * handle's `source` follows.
 */
export const CLAUDE_SDK_SOURCE = "claude-code/sdk" as const;

/** The pre-LAB-152 spelling, still found in handles persisted before the rule. */
const LEGACY_SDK_SOURCE = "sdk";

/**
 * How the SDK's terminal subtype reads in the framework's neutral vocabulary.
 *
 * The mapping lives here, at the one place the vendor's word is known, so no
 * reader downstream ever branches on an SDK enum. A turn cap and a budget cap
 * are both limits the run was stopped at; every other non-success failed.
 *
 * **Whether a terminal result ARRIVED is a separate fact from whether its
 * subtype was RECOGNIZED**, which is why the caller passes it rather than
 * having it inferred from `subtype === null`. `normalizeSubtype` maps an
 * unrecognized subtype — a future SDK failure mode — to `null`, the same value
 * a run that never produced a result carries. Collapsing the two would report
 * `outcome: null` for a run that demonstrably failed, and `null` is the one
 * thing a manager reads as "no terminal result arrived" (LAB-154 settles runs
 * on this field). `translate.ts` guards the same hazard by keying its error
 * event off the raw subtype.
 */
export function outcomeFromResultSubtype(
  subtype: SdkResultSubtype | null,
  terminalResultArrived: boolean,
): HarnessRunOutcome | null {
  if (!terminalResultArrived) return null;
  switch (subtype) {
    case "success":
      return "finished";
    case "error_max_turns":
    case "error_max_budget_usd":
      return "stopped-at-limit";
    // Includes `null`: a terminal result arrived and its subtype is not one
    // this package knows. It was not a success, so the run failed.
    default:
      return "failed";
  }
}

/**
 * Handle for a single in-process Agent SDK run.
 *
 * The framework's neutral harness handle plus Claude's own extras. Unlike the
 * fire-and-forget CLI handle, the SDK path observes the run to completion, so
 * `status` reaches `"completed"`/`"errored"` and the handle carries the final
 * assistant text, the tools the SDK exercised, and usage/cost when the SDK
 * reported them. Usage and cost are `null` when the SDK result omitted them —
 * values are never invented.
 */
export interface SdkAgentHandle extends HarnessRunHandle {
  source: typeof CLAUDE_SDK_SOURCE;
  status: "running" | "completed" | "errored";
  /** The SDK's terminal `result.subtype`, or `null` if the run never produced one. */
  resultSubtype: SdkResultSubtype | null;
  /** Distinct SDK tool names observed during the run, in first-seen order. */
  toolsObserved: string[];
}

/**
 * Runtime validator for {@link SdkAgentHandle}.
 *
 * A handle persisted under the old `"sdk"` spelling reads through to the new
 * value, and one persisted before `outcome`/`cost` existed picks them up as
 * `null` from the neutral schema's defaults (BP-030).
 *
 * **`costUsd` is gone and is not rejected.** It was a dual carried beside the
 * neutral `cost` for one release, while the run manager still read it; the
 * manager reads `cost` now, so nothing reads the dual. Handles persisted with
 * it still parse — zod strips the unknown key rather than failing — which is
 * what BP-030 asks for on a field that was only ever a copy of one still here.
 */
export const sdkAgentHandleSchema = harnessRunHandleSchema.extend({
  source: z.preprocess(
    (value) => (value === LEGACY_SDK_SOURCE ? CLAUDE_SDK_SOURCE : value),
    z.literal(CLAUDE_SDK_SOURCE),
  ),
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
  toolsObserved: z.array(z.string()),
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
      /**
       * The tool's full structured Output object — a MESSAGE-level sibling of
       * the content blocks below, not a field on one. The two carry different
       * things and must not be conflated: `content[].tool_result.content` is the
       * prose string shown to the model ("File created successfully at: …"),
       * while this carries the declared Output (`filePath`, `structuredPatch`,
       * `task.id`, …). Optional and untyped on purpose — it is absent on older
       * messages and its shape is the vendor's, so every read of it is a
       * tolerated probe rather than a contract (BP-030).
       */
      tool_use_result?: unknown;
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
  /**
   * The run's file tools touched a path. Framework vocabulary: by the time this
   * exists the tool names are gone, which is what keeps the vendor mapping to
   * one site. Emitted twice per mutation — once when the call is seen
   * (`outcome: "pending"`) and once when its result settles it.
   */
  | {
      kind: "file_op_observed";
      /**
       * The tool call this belongs to. The RECORD is keyed by subject (the
       * path), but mutations are per call, and two calls can be in flight on
       * one path at once. Without this the recorder cannot tell whose
       * settlement it is holding, and the earlier call's result settles a row
       * that a later, still-unfinished call is also using — hiding an
       * unresolved mutation behind an `applied`.
       */
      callId: string;
      /**
       * The path as the run addressed it AT CALL TIME; the recorder
       * canonicalizes it into the row's key. Stable across the attempt and its
       * settlement, which is what keeps one operation to one row.
       */
      path: string;
      /**
       * The path the harness reported instead, present on a settlement only
       * when it differs from {@link path} as a raw string. Not a second key —
       * the recorder canonicalizes both and, if they still differ, records the
       * divergence as a gap rather than silently keying under either.
       */
      resolvedPath?: string;
      op: ObservedFileOpKind;
      outcome: ObservedOutcome;
    }
  /**
   * The run's own to-do list moved. `itemId` is the harness's id for the item,
   * recovered from its create result — never inferred from call order, because
   * the ids are not positional. `title` rides the create; `status` rides an
   * update the harness confirmed, and is deliberately absent on a rejected one.
   */
  | {
      kind: "plan_item_observed";
      /** The tool call this belongs to. See `file_op_observed`'s `callId`. */
      callId: string;
      itemId: string;
      title?: string;
      status?: string;
      /**
       * The status the harness says the item held BEFORE this move, when it
       * reports one. Authoritative: it is the only source for the prior status
       * on a first move, because a create result carries no status at all and
       * a recorder deriving it from what it has seen can only produce nothing.
       */
      previousStatus?: string;
      outcome: ObservedOutcome;
    }
  /**
   * A mutation this package RECOGNISED and could not record. Emitted by
   * translation when a known tool's call carries nothing to key on, and by the
   * recorder when a key or a write fails.
   *
   * A tool we never claimed to record does NOT produce one of these: absence
   * there is the designed answer, and calling it a gap would bury the real ones.
   */
  | {
      kind: "work_gap_observed";
      /**
       * Which record this gap stands in for. Named `subject` here only because
       * `kind` is the union's discriminant; it lands on the row AS `kind`,
       * which is what a reader keys off.
       */
      subject: ObservedGapKind;
      reason: string;
      rawPath?: string;
    }
  /** A transient system/lifecycle notice (init, compaction). */
  | { kind: "status"; message: string }
  /** A terminal error outcome from the SDK result. */
  | { kind: "error"; message: string; code?: string }
  /** The SDK's terminal result, carrying session id, usage, and cost. */
  | {
      kind: "result";
      subtype: SdkResultSubtype | null;
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
 * The SDK `query()` function shape this package calls. Structural so a scripted
 * fake satisfies it in tests without importing the SDK. Returns an async
 * iterable of {@link SdkMessageLike}.
 */
export type ClaudeAgentQuery = (args: {
  prompt: string | AsyncIterable<unknown>;
  options?: ClaudeAgentQueryOptions;
}) => AsyncIterable<SdkMessageLike>;

/** Options forwarded to the SDK `query()` call. Loosely typed by design. */
export interface ClaudeAgentQueryOptions {
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  canUseTool?: SdkCanUseTool;
  agents?: unknown;
  maxTurns?: number;
  resume?: string;
  includePartialMessages?: boolean;
  /**
   * The directory the run works in. The SDK's own file tools address paths
   * relative to it, and the block keys its record of what the run touched there
   * too — see `ClaudeCodeAgentOptions.cwd`, which is canonical for both halves.
   */
  cwd?: string;
  /**
   * Which filesystem settings the run loads — `user`, `project`, `local`.
   *
   * Omitted and the SDK loads all of them, matching the CLI. `[]` loads none.
   * The distinction matters more than it looks: `project` is what makes the
   * run read `CLAUDE.md` and `.claude/settings.json` from its working
   * directory, so a directory the run did not come with can otherwise
   * configure the agent working in it.
   */
  settingSources?: ClaudeAgentSettingSource[];
  /** Environment variables for the run's own process. */
  env?: Record<string, string | undefined>;
  /**
   * The SDK's sandbox settings, forwarded verbatim.
   *
   * Loosely typed for the same reason as `agents`: this package treats the SDK
   * as an optional peer, and importing its types here would make a scripted
   * fake need the real dependency.
   */
  sandbox?: unknown;
  /** Forwarded to the SDK so an aborted `ctx.signal` stops the run. */
  abortController?: AbortController;
}

/**
 * A filesystem settings source the run may load from.
 *
 * Declared here rather than imported from the SDK so the option is usable —
 * and typo-proof — without the optional peer installed.
 */
export type ClaudeAgentSettingSource = "user" | "project" | "local";

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
  ctx: BlockContext<any, any, any, any, any, any, any, any, any>,
) => ResolvedClaudeAgent | Promise<ResolvedClaudeAgent>;

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
