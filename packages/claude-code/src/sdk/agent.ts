/**
 * `claudeCodeAgent` — handler block running the Claude Code Agent SDK in-process.
 *
 * This is the FIX-671 "Level 2 agent adapter": the SDK owns its own agentic
 * loop and built-in tools; FSD observes, translates, and persists. The block
 * resumes a prior SDK session (via the session provider + persisted
 * `sdkSessionId`), runs `query()` to completion, pipes each streamed message
 * through `translate` → `emit` to produce canonical FSD items, records the new
 * session id, appends the run handle to session state, and returns the handle.
 *
 * HITL degrades to the SDK's own `permissionMode` / `canUseTool`; an optional
 * `onToolApproval` seam adapts onto `canUseTool` and notes its decision via a
 * status item. Sub-agents surface as container items (see `emit.ts`).
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  closeStreamingItems,
  createEmitState,
  emitTranslatedEvent,
  finalizeOpenItems,
} from "./emit";
import { createTranslateState, translateSdkMessage } from "./translate";
import { defaultResolveClaudeAgent } from "./sdk-client";
import { createClaudeAgentSessionProvider, type ClaudeAgentSession } from "./session";
import { ClaudeAgentRunError } from "./errors";
import {
  sdkAgentHandleSchema,
  type ClaudeAgentQueryOptions,
  type ResolveClaudeAgent,
  type SdkAgentHandle,
  type SdkCanUseTool,
  type SdkResultSubtype,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
} from "./types";
import type { BindingProvider } from "@flow-state-dev/core/types";

/** Session-state key holding the SDK session id to resume across requests. */
export const SDK_SESSION_ID_KEY = "sdkSessionId" as const;
/** Session-state key under which run handles accumulate. */
export const SDK_AGENT_RUNS_KEY = "sdkAgentRuns" as const;

/** Session-state schema the agent block declares, reads, and appends to. */
export const claudeAgentSessionStateSchema = z.object({
  [SDK_SESSION_ID_KEY]: z.string().nullable().default(null),
  [SDK_AGENT_RUNS_KEY]: z.array(sdkAgentHandleSchema).default([]),
});

const inputSchema = z.object({
  /** The instruction prompt to run through the agent loop. */
  prompt: z.string(),
});

/** Options for {@link claudeCodeAgent}. */
export interface ClaudeCodeAgentOptions {
  /** Host hook resolving the SDK `query`. Default: lazy SDK import. */
  resolveClaudeAgent?: ResolveClaudeAgent;
  /** Session-continuity provider. Default: resume-by-id provider. */
  sessionProvider?: BindingProvider<ClaudeAgentSession>;
  /** Derive the prompt from input/ctx. Default: `input.prompt`. */
  prompt?: (input: { prompt: string }, ctx: BlockContext) => string;
  /** Model id forwarded to the SDK. */
  model?: string;
  /** System prompt forwarded to the SDK. */
  systemPrompt?: string;
  /** Allowed tool names forwarded to the SDK. */
  allowedTools?: string[];
  /** Disallowed tool names forwarded to the SDK. */
  disallowedTools?: string[];
  /** Permission mode forwarded to the SDK (HITL default behavior). */
  permissionMode?: string;
  /** Sub-agent definitions forwarded to the SDK `agents` option. */
  agents?: unknown;
  /** Max turns forwarded to the SDK. */
  maxTurns?: number;
  /** Whether to request partial-message deltas. Default: true. */
  includePartialMessages?: boolean;
  /**
   * Optional approval seam. When set, it is adapted onto the SDK `canUseTool`
   * callback: each tool call routes through it, and the decision is noted via a
   * status item. When unset, HITL degrades to the SDK's own `permissionMode`.
   */
  onToolApproval?: (
    req: ToolApprovalRequest,
    ctx: BlockContext,
  ) => ToolApprovalDecision | Promise<ToolApprovalDecision>;
  /** Block name. Default `"claude-code-agent"`. */
  name?: string;
}

/**
 * A terminal subtype counts as an errored outcome unless it is exactly
 * `"success"`. `null` here means the SDK reported a subtype this version does
 * not recognize (`normalizeSubtype` only nulls unknown values — `"success"` is
 * always recognized), so it is a failure, not a silent success.
 */
function isErroredSubtype(subtype: SdkResultSubtype | null): boolean {
  return subtype !== "success";
}

/**
 * Create an {@link AbortController} that mirrors the block's `ctx.signal`, so an
 * aborted request stops the in-process SDK run. Tolerates an absent signal
 * (returns a live, un-aborted controller). Forwards an already-aborted signal
 * synchronously, and a later abort via a one-shot listener.
 */
export function forwardSignalToController(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller;
}

/**
 * Create the in-process Agent SDK handler block.
 *
 * On success it appends an {@link SdkAgentHandle} to
 * `ctx.session.state.sdkAgentRuns`, persists the new `sdkSessionId`, emits a
 * final status item, and returns the handle. An empty prompt throws before
 * `query` is called. A terminal SDK error subtype is an outcome (handle with
 * `status:"errored"` + an error item), not a throw; an SDK throw mid-stream is
 * wrapped in {@link ClaudeAgentRunError}, surfaced as an error item, and
 * rethrown.
 */
export function claudeCodeAgent(options: ClaudeCodeAgentOptions = {}) {
  const {
    resolveClaudeAgent = defaultResolveClaudeAgent,
    sessionProvider = createClaudeAgentSessionProvider(),
    prompt: pickPrompt,
    model,
    systemPrompt,
    allowedTools,
    disallowedTools,
    permissionMode,
    agents,
    maxTurns,
    includePartialMessages = true,
    onToolApproval,
    name = "claude-code-agent",
  } = options;

  return handler({
    name,
    description:
      "Run the Claude Code Agent SDK in-process, translating its streamed messages into FSD items.",
    inputSchema,
    outputSchema: sdkAgentHandleSchema,
    sessionStateSchema: claudeAgentSessionStateSchema,
    execute: async (input, ctx): Promise<SdkAgentHandle> => {
      const promptText = (pickPrompt ? pickPrompt(input, ctx) : input.prompt)?.trim();
      if (!promptText) {
        throw new ClaudeAgentRunError("claudeCodeAgent requires a non-empty prompt.");
      }

      const priorSessionId = (ctx.session.state as Record<string, unknown>)[SDK_SESSION_ID_KEY];
      const session = await sessionProvider.resolve(
        typeof priorSessionId === "string" ? priorSessionId : "",
      );

      const resolved = await resolveClaudeAgent(ctx);
      const dispatchedAt = Date.now();
      const abortController = forwardSignalToController(ctx.signal);

      const queryOptions: ClaudeAgentQueryOptions = {
        model,
        systemPrompt,
        allowedTools,
        disallowedTools,
        permissionMode,
        agents,
        maxTurns,
        includePartialMessages,
        abortController,
        ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {}),
        ...(onToolApproval ? { canUseTool: buildCanUseTool(onToolApproval, ctx) } : {}),
      };

      const translateState = createTranslateState({ partialMessages: includePartialMessages });
      const emitState = createEmitState();

      let resultSubtype: SdkResultSubtype | null = null;
      let finalMessage: string | null = null;
      let newSessionId: string | null = session.sdkSessionId;
      let usage: SdkAgentHandle["usage"] = null;
      let costUsd: number | null = null;

      try {
        for await (const message of resolved.query({ prompt: promptText, options: queryOptions })) {
          const events = translateSdkMessage(message, translateState);
          for (const event of events) {
            await emitTranslatedEvent(event, ctx, emitState, name);
            if (event.kind === "result") {
              resultSubtype = event.subtype;
              if (event.sessionId !== null) newSessionId = event.sessionId;
              if (event.finalMessage !== null) finalMessage = event.finalMessage;
              if (event.usage !== null) usage = event.usage;
              if (event.costUsd !== null) costUsd = event.costUsd;
            }
          }
          // Partials path: the whole `assistant` message is the turn's close
          // boundary. translate skips its text/thinking (already streamed), so
          // close the open streaming items here before the next turn's deltas.
          if (includePartialMessages && message.type === "assistant") {
            await closeStreamingItems(ctx, emitState);
          }
        }
      } catch (err) {
        await finalizeOpenItems(ctx, emitState, name);
        const wrapped = new ClaudeAgentRunError(
          `Claude Code agent run failed: ${(err as Error).message}`,
          { cause: (err as Error).message },
        );
        await emitTranslatedEvent(
          { kind: "error", message: wrapped.message, code: wrapped.code },
          ctx,
          emitState,
          name,
        );
        throw wrapped;
      }

      await finalizeOpenItems(ctx, emitState, name);

      // Prefer the coalesced/whole assistant text the emitter tracked; fall
      // back to the SDK result's text.
      finalMessage = emitState.finalMessage ?? finalMessage;

      const errored = isErroredSubtype(resultSubtype);
      const handle: SdkAgentHandle = {
        source: "sdk",
        status: errored ? "errored" : "completed",
        sessionId: newSessionId,
        url: null,
        dispatchedAt,
        resultSubtype,
        finalMessage,
        toolsObserved: emitState.toolsObserved,
        usage,
        costUsd,
      };

      if (newSessionId !== null) {
        await ctx.session.patchState(SDK_SESSION_ID_KEY, () => newSessionId);
      }
      await ctx.session.patchState(SDK_AGENT_RUNS_KEY, (prev) => [
        ...((prev as SdkAgentHandle[] | undefined) ?? []),
        handle,
      ]);

      ctx.emit.status(
        errored
          ? `Claude Code agent run errored (${resultSubtype}).`
          : "Claude Code agent run completed.",
        { transient: false },
      );

      return handle;
    },
  });
}

/**
 * Adapt an {@link ClaudeCodeAgentOptions.onToolApproval} seam onto the SDK's
 * `canUseTool` callback. The SDK invokes `canUseTool(toolName, input, extra)`
 * where `extra = { signal, suggestions }`; the `extra.signal` is forwarded to
 * the approval request so a host UI can cancel a pending prompt. Each decision
 * is recorded as a DURABLE, non-colliding status item (auditable: it replays on
 * history reload, and a per-decision sequence number defeats `emitStatus`'s
 * same-string dedupe so repeated approvals of one tool aren't swallowed). A deny
 * continues the run (the SDK surfaces the denial to the model).
 */
function buildCanUseTool(
  onToolApproval: NonNullable<ClaudeCodeAgentOptions["onToolApproval"]>,
  ctx: BlockContext,
): SdkCanUseTool {
  let decisionSeq = 0;
  return async (toolName, toolInput, extra) => {
    const decision = await onToolApproval(
      { toolName, input: toolInput, signal: extra?.signal },
      ctx,
    );
    const seq = ++decisionSeq;
    if (decision.decision === "allow") {
      ctx.emit.status(`Approved tool: ${toolName} (#${seq}).`, { transient: false });
      return {
        behavior: "allow",
        updatedInput: decision.updatedInput ?? toolInput,
      };
    }
    ctx.emit.status(`Denied tool: ${toolName} (#${seq}).`, { transient: false });
    return {
      behavior: "deny",
      message: decision.message ?? `Tool ${toolName} was denied.`,
    };
  };
}
