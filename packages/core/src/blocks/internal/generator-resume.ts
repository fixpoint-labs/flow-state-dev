/**
 * Visibility-agnostic conversation reconstruction for generator resume
 * (FIX-814).
 *
 * When a request continues after a generator tool called `ctx.suspend()`, the
 * generator block re-runs its owned tool loop from the top. Instead of
 * re-calling the model for every recorded step, it rebuilds the conversation
 * from the durable item log and continues past the approved call. This module
 * is the pure, visibility-agnostic heart of that: given the request's prior
 * items and the pending suspension, it produces the reconstructed `messages`,
 * the recorded step count, and the classification of the suspending step's
 * tool calls.
 *
 * It deliberately does NOT use engine's history-gated `itemToLLMMessages`
 * (which drops `history:false` items) — a `history:false` generator must still
 * resume with its turns intact. It reuses the shared, visibility-agnostic
 * builders in `@flow-state-dev/core/models` (the same ones the live inter-step
 * loop uses), so live and resume message shapes agree.
 *
 * Source of truth:
 *   - each tool-calling step's assistant turn + tool-call array + buffered text
 *     comes from the replay-only `generator_step` artifact (written before the
 *     step dispatched its tools);
 *   - each settled call's result comes from its persistent `tool_output` item,
 *     read via the persisted `modelOutput` so a `mapModelOutput` mapper is
 *     never recomputed on resume.
 */
import type { GeneratorStepItem, ToolOutputItem } from "../../items/types";
import type { RuntimeItem } from "../../items/internal";
import type { GeneratorStepResult } from "../../types/model";
import type { LLMMessage } from "../../types/scope";
import { FlowError } from "../../errors/flow-error";
import {
  buildAssistantToolCallMessage,
  buildToolResultMessage,
  failedToolResultText,
  toolResultOutputForModel,
  type LLMToolCallPart,
} from "../../models/llm-messages";
import { blockPathTool, extendBlockPath } from "./block-instance-id";

/**
 * Fatal, non-retryable resume error: the recorded pending generator tool no
 * longer resolves in the freshly-resolved tool set (a dynamic `tools` resolver
 * dropped it between suspend and resume). Mirrors `RouteUnavailableError`'s
 * "never silently re-decide" contract for the generator half — re-entering a
 * missing (or swapped) tool under the approved call's identity would either
 * fail or silently run the wrong tool.
 */
export class GeneratorToolUnavailableError extends FlowError {
  constructor(generatorBlockName: string, toolName: string) {
    super(
      `Generator "${generatorBlockName}" cannot resume: the suspended tool "${toolName}" is no longer present in the resolved tool set. A resumable generator's \`tools\` resolver must keep the pending tool available and stable across the suspend window.`,
      {
        code: "generator_tool_unavailable",
        retryable: false,
        blockName: generatorBlockName,
        scope: "block",
        details: { toolName },
      }
    );
    this.name = "GeneratorToolUnavailableError";
  }
}

/** How a suspending step's tool call is resolved on resume. */
export type ResumeCallKind =
  /** A completed `tool_output` exists — inject its recorded result, do NOT re-run. */
  | "completed"
  /** The winning pending gate — re-enter; `ctx.suspend()` returns the payload. */
  | "pending"
  /** A losing concurrent suspension (SUSPENSION-coded, not the pending gate) —
   *  re-enter to re-attempt its own gate; NOT surfaced to the model. */
  | "losing"
  /** An ordinary tool failure — surface a model-visible error, do NOT re-run. */
  | "failed"
  /** No `tool_output` was ever persisted (crash before dispatch) — re-run. */
  | "missing";

/** One classified tool call within the suspending step. */
export interface ResumeStepCall {
  toolCallId: string;
  /** Framework block name of the tool. */
  toolName: string;
  /** Model-facing disambiguated alias. */
  alias: string;
  /** The call arguments the model issued. */
  arguments: unknown;
  kind: ResumeCallKind;
  /** For `completed`: the persisted model-facing output (`modelOutput ?? output`). */
  modelOutput?: unknown;
  /** For `failed`: the error message to surface to the model. */
  errorMessage?: string;
  /** The candidate logical id (`${requestId}:${path}`) used for gate matching. */
  candidateLogicalId: string;
}

/** The step holding the pending gate — its calls are re-run/injected on resume. */
export interface ResumeStep {
  stepNumber: number;
  text?: string;
  calls: ResumeStepCall[];
}

/** The reconstruction result the owned loop consumes on resume. */
export interface GeneratorResumeReconstruction {
  /**
   * The rebuilt conversation for the prelude + every fully-recorded step
   * BEFORE the suspending step. The suspending step's assistant turn is built
   * by the loop after it re-runs/injects that step's tool calls.
   */
  messages: LLMMessage[];
  /** True when the step-0 `prelude` was found and prepended to `messages`. */
  preludeIncluded: boolean;
  /** Reconstructed `GeneratorStepResult`s for the steps preceding the
   *  suspending step (loop metadata for `prepareStep`/`stopWhen`). */
  priorSteps: GeneratorStepResult[];
  /** The suspending step to re-run/inject, or `undefined` when no pending gate
   *  belongs to this generator (not a generator-tool resume). */
  resumeStep: ResumeStep | undefined;
}

/** Group a request's items into this generator's step artifacts + tool outputs. */
function collectGeneratorItems(
  items: readonly RuntimeItem[],
  generatorLogicalId: string
): { artifacts: GeneratorStepItem[]; toolOutputs: ToolOutputItem[] } {
  const artifacts: GeneratorStepItem[] = [];
  const toolOutputs: ToolOutputItem[] = [];
  for (const item of items) {
    if (item.type === "generator_step") {
      const art = item as GeneratorStepItem;
      // logicalId is `${requestId}:${path}`; the artifact carries the
      // generator's `${requestId}:${path}:${attempt}` instance id.
      if (logicalIdOfInstance(art.blockInstanceId) === generatorLogicalId) {
        artifacts.push(art);
      }
    } else if (item.type === "tool_output") {
      const to = item as ToolOutputItem;
      // Scope to THIS generator's logical path, not any generator's output. A
      // `tool_output` carries its owning generator's `blockInstanceId` as
      // provenance, so two generators in one request that happen to share a
      // provider call id can't cross-contaminate: without this, a pending call
      // could consume another generator's completed output and skip re-entering
      // the approved tool.
      if (
        to.toolCall.generatorBlock !== undefined &&
        logicalIdOfInstance(to.provenance?.blockInstanceId ?? "") === generatorLogicalId
      ) {
        toolOutputs.push(to);
      }
    }
  }
  artifacts.sort((a, b) => a.stepNumber - b.stepNumber);
  return { artifacts, toolOutputs };
}

/** Strip the trailing `:attempt` to get `${requestId}:${path}`. */
function logicalIdOfInstance(instanceId: string): string {
  const last = instanceId.lastIndexOf(":");
  return last === -1 ? instanceId : instanceId.slice(0, last);
}

/**
 * Pick the canonical `tool_output` for a call id: a `completed` result (a
 * re-entered gate's real return value from an earlier resume cycle) supersedes
 * an earlier `failed` (suspended) record for the same call.
 *
 * Matched on the bare call id (scoped to unconsumed candidates by the caller),
 * which assumes a call id is unique within a generator instance — true for real
 * providers. The suspend/resume gate-matching itself keys off the step-folded
 * tool path, so this pairing is a fidelity concern for the reconstructed
 * conversation, not the gate resolution.
 */
function pickToolOutput(
  toolOutputs: readonly ToolOutputItem[],
  callId: string
): ToolOutputItem | undefined {
  let best: ToolOutputItem | undefined;
  for (const to of toolOutputs) {
    if (to.toolCall.callId !== callId) continue;
    if (best === undefined) {
      best = to;
      continue;
    }
    const bestCompleted = best.status === "completed";
    const completed = to.status === "completed";
    if ((completed && !bestCompleted) || (completed === bestCompleted && to.itemIndex > best.itemIndex)) {
      best = to;
    }
  }
  return best;
}

/**
 * Reconstruct a generator's resume state from the durable item log.
 *
 * Returns `undefined` when this generator has no recorded step artifacts (it
 * never entered its owned loop before the interruption — nothing to
 * reconstruct). When artifacts exist but no pending gate belongs to this
 * generator, `resumeStep` is `undefined` and every step is rebuilt into
 * `messages` (the loop then continues normally from `priorSteps.length`).
 *
 * @param requestId The current request id (to build candidate logical paths).
 * @param generatorLogicalId The generator's `${requestId}:${path}`.
 * @param generatorToolBasePath The generator's structural path — the parent of
 *   its tool paths (`ctx._blockIdentity.blockPath`).
 * @param pendingBlockLogicalId The pending suspension's logical id, or
 *   `undefined`. Matched by PREFIX against each candidate tool path to cover
 *   composite tools that suspend below their own scope.
 */
export function reconstructGeneratorResume(params: {
  items: readonly RuntimeItem[];
  requestId: string;
  generatorLogicalId: string;
  generatorToolBasePath: string;
  pendingBlockLogicalId: string | undefined;
}): GeneratorResumeReconstruction | undefined {
  const { items, requestId, generatorLogicalId, generatorToolBasePath, pendingBlockLogicalId } =
    params;
  const { artifacts, toolOutputs } = collectGeneratorItems(items, generatorLogicalId);
  if (artifacts.length === 0) return undefined;

  const messages: LLMMessage[] = [];
  const priorSteps: GeneratorStepResult[] = [];
  let preludeIncluded = false;

  const step0 = artifacts.find((a) => a.stepNumber === 0);
  if (step0?.prelude !== undefined) {
    messages.push(...(step0.prelude as LLMMessage[]));
    preludeIncluded = true;
  }

  const candidateLogicalId = (art: GeneratorStepItem, callId: string, toolName: string): string =>
    `${requestId}:${extendBlockPath(
      generatorToolBasePath,
      blockPathTool(toolName, `${art.stepNumber}:${callId}`)
    )}`;

  const isPendingGate = (candidate: string): boolean =>
    pendingBlockLogicalId !== undefined &&
    (pendingBlockLogicalId === candidate || pendingBlockLogicalId.startsWith(candidate + "/"));

  let resumeStep: ResumeStep | undefined;
  const consumed = new Set<ToolOutputItem>();

  for (const art of artifacts) {
    const calls: ResumeStepCall[] = art.toolCalls.map((c) => {
      const candidate = candidateLogicalId(art, c.toolCallId, c.toolName);
      const base = {
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        alias: c.alias,
        arguments: c.arguments,
        candidateLogicalId: candidate,
      };
      // Prefer a completed output; among ties consume the not-yet-consumed one.
      let to = pickToolOutput(
        toolOutputs.filter((t) => !consumed.has(t)),
        c.toolCallId
      );
      if (to === undefined) to = pickToolOutput(toolOutputs, c.toolCallId);
      if (to !== undefined) consumed.add(to);

      if (to === undefined) {
        return { ...base, kind: "missing" as const };
      }
      if (to.status === "completed") {
        return {
          ...base,
          kind: "completed" as const,
          modelOutput: to.modelOutput !== undefined ? to.modelOutput : to.output,
        };
      }
      if (to.status !== "failed") {
        // A crash mid-tool can persist an `in_progress` `tool_output`
        // (`item.added` fired but `item.done` never landed). That record is
        // incomplete, not a genuine failure — re-run the call on resume,
        // exactly like the absent (`missing`) case, rather than surfacing it to
        // the model as an error. (§4.6: crash-mid-tool → tool re-runs.)
        return { ...base, kind: "missing" as const };
      }
      // status === "failed"
      if (isPendingGate(candidate)) {
        return { ...base, kind: "pending" as const };
      }
      if (to.error?.code === "SUSPENSION") {
        return { ...base, kind: "losing" as const };
      }
      return {
        ...base,
        kind: "failed" as const,
        errorMessage: to.error?.message ?? "unknown error",
      };
    });

    const isResumeStep = calls.some(
      (c) => c.kind === "pending" || c.kind === "losing" || c.kind === "missing"
    );
    if (isResumeStep) {
      resumeStep = { stepNumber: art.stepNumber, text: art.text, calls };
      break;
    }

    // Fully-recorded step: rebuild its assistant turn + per-call result
    // messages and thread its loop metadata.
    messages.push(buildRecordedAssistantMessage(art));
    for (const c of calls) {
      messages.push(buildRecordedResultMessage(c));
    }
    priorSteps.push({
      text: art.text,
      toolCalls: art.toolCalls.map((c) => ({
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        args: c.arguments,
      })),
    });
  }

  return { messages, preludeIncluded, priorSteps, resumeStep };
}

/** One assistant message per step, from the artifact's full tool-call array. */
function buildRecordedAssistantMessage(art: GeneratorStepItem): LLMMessage {
  const parts: LLMToolCallPart[] = art.toolCalls.map((c) => ({
    toolCallId: c.toolCallId,
    toolName: c.alias,
    input: c.arguments,
  }));
  return buildAssistantToolCallMessage(parts, art.text);
}

/** The tool-result message for a fully-recorded call. */
function buildRecordedResultMessage(c: ResumeStepCall): LLMMessage {
  const call = { toolCallId: c.toolCallId, toolName: c.alias };
  if (c.kind === "failed") {
    return buildToolResultMessage(call, {
      type: "error-text",
      value: failedToolResultText(c.toolName, c.errorMessage ?? "unknown error"),
    });
  }
  // completed — use the persisted model-facing output verbatim (never
  // recompute a mapper).
  return buildToolResultMessage(call, toolResultOutputForModel(c.modelOutput));
}

/**
 * Validates that the recorded pending tool still resolves in the freshly
 * resolved tool set. Throws {@link GeneratorToolUnavailableError} on mismatch
 * (never silently re-decides). Name presence is the enforced check; deeper
 * definition-stability is left to the tool's own resolver contract.
 */
export function validateResumableTool(
  generatorBlockName: string,
  toolName: string,
  resolvedToolNames: ReadonlySet<string>
): void {
  if (!resolvedToolNames.has(toolName)) {
    throw new GeneratorToolUnavailableError(generatorBlockName, toolName);
  }
}
