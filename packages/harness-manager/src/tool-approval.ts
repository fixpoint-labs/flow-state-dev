/**
 * A coding run's tool calls, approved by a person (FIX-2389).
 *
 * With `approveTools` on, a manager hands its harness an `onToolApproval`
 * feed. A call the harness hasn't pre-allowed comes to it; one a grant of
 * this run covers is allowed, and any other is **held**: the run stops with
 * the call unrun, waits as its suspension (`suspendForUser({ kind:
 * "approval" })`, which the claim gate mirrors as the task's hold and the
 * Inbox lists), and resumes the same coding session after the answer. The
 * model asks for the call again there, and the answer's grant lets it pass.
 *
 * These are the pieces of that wait that are not the manager's own loop, so a
 * flow other than the manager (a session flow) composes the same ones:
 *
 * - the feed's types ({@link HarnessToolApprovalHook}), structurally the
 *   same as `@flow-state-dev/claude-code`'s `onToolApproval` option, so a slot
 *   that spreads `...feeds` into `claudeCodeAgent` type-checks with neither
 *   package importing the other;
 * - what a held call is ({@link heldToolCallOf}) and the decision that holds
 *   it ({@link heldToolDecision});
 * - the grant rule ({@link grantMatches}): the same tool, with the same
 *   command or file;
 * - the stop a held call waits on ({@link toolApprovalStop}), and what its
 *   answer means for the run ({@link toolApprovalOutcome}).
 *
 * The feed's types live here rather than in core's harness contract, because
 * the epic's ER-1 keeps new harness nouns out of core.
 */
import type { ApprovalAnswer, HarnessCallbackContext, SuspendForUserOptions } from "@flow-state-dev/core/types";
import { z } from "zod";
import { toolCallTouches } from "./progress-note";

/** One tool call the harness asks about, before it runs. */
export interface HarnessToolApprovalRequest {
  /** The tool's name as the harness calls it (`Bash`, `Edit`, `mcp__<server>__<tool>`). */
  toolName: string;
  /** The call's arguments, as the model issued them. */
  input: unknown;
  /** The harness's abort signal for this one call, when it has one. */
  signal?: AbortSignal;
}

/**
 * What the feed answers for one call.
 *
 * - `allow`: the call runs (with `updatedInput`, when given).
 * - `deny`: it doesn't, the model is told with `message`, and the turn goes on.
 * - `held`: it doesn't run now, and the turn stops: a person decides it
 *   outside this run, and the session resumes with the answer.
 */
export type HarnessToolApprovalDecision =
  | { decision: "allow"; updatedInput?: unknown }
  | { decision: "deny"; message?: string }
  | { decision: "held"; message?: string };

/**
 * The `onToolApproval` feed: called by a harness that can ask about each tool
 * call before it runs (Claude Code). A harness that can't ignores it.
 */
export type HarnessToolApprovalHook = (
  request: HarnessToolApprovalRequest,
  ctx: HarnessCallbackContext,
) => HarnessToolApprovalDecision | Promise<HarnessToolApprovalDecision>;

/** A call held for a person, as its stop names it and a grant matches it. */
export const heldToolCallSchema = z.object({
  /** The tool's name. */
  toolName: z.string(),
  /** The command, file or other thing the call touches (`progressNoteOf`'s keys), or `null`. */
  touches: z.string().nullable(),
  /** What a grant matches beside the tool: `touches`, else the call's arguments as canonical JSON. */
  key: z.string(),
  /** The run's working folder. */
  cwd: z.string(),
});
export type HeldToolCall = z.infer<typeof heldToolCallSchema>;

/**
 * A grant a person's yes leaves on the run: `once` lets the next matching
 * call through and is spent; `run` lets every matching call through for the
 * rest of the run (one try of the task; a retry asks again).
 */
export const toolGrantSchema = z.object({
  toolName: z.string(),
  key: z.string(),
  scope: z.enum(["once", "run"]),
});
export type ToolGrant = z.infer<typeof toolGrantSchema>;

/** The data a yes sends for *Allow for this run*. A plain yes sends none. */
export const toolApprovalYesSchema = z.object({ scope: z.literal("run").optional() }).strict();

/**
 * The extra yes the stop offers, under `data.approveOptions`: the label a card
 * shows and the data its yes sends. Read by any approval card that draws a
 * stop's `approveOptions` (the registry's `approval` card does).
 */
export const ALLOW_FOR_RUN = { label: "Allow for this run", data: { scope: "run" } } as const;

/** Canonical JSON: object keys sorted, so the same arguments give the same key. */
function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    if (seen.has(node)) return "[cycle]";
    seen.add(node);
    if (Array.isArray(node)) return node.map(walk);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node).sort()) out[key] = walk((node as Record<string, unknown>)[key]);
    return out;
  };
  return JSON.stringify(walk(value)) ?? String(value);
}

/**
 * The held call a request is: its tool, what it touches, its grant key and
 * the folder it would run in.
 *
 * @param request The call the harness asked about.
 * @param cwd The run's working folder.
 */
export function heldToolCallOf(request: Pick<HarnessToolApprovalRequest, "toolName" | "input">, cwd: string): HeldToolCall {
  const touches = toolCallTouches(request.input);
  return { toolName: request.toolName, touches, key: touches ?? canonicalJson(request.input), cwd };
}

/** The feed's answer for a call it holds: the call doesn't run, and the turn stops. */
export function heldToolDecision(call: HeldToolCall): HarnessToolApprovalDecision {
  return {
    decision: "held",
    message: `${describeCall(call)} waits for a person's approval. Stop here; you will be resumed with their answer.`,
  };
}

/**
 * Whether a grant lets a call through: the same tool with the same command or
 * file (or, for a call that names neither, the same arguments). Never the
 * tool alone, so allowing one command for the run doesn't let every other
 * command through.
 */
export function grantMatches(grant: Pick<ToolGrant, "toolName" | "key">, call: Pick<HeldToolCall, "toolName" | "key">): boolean {
  return grant.toolName === call.toolName && grant.key === call.key;
}

/** The call as a person reads it: `Bash: pnpm test`, or the tool alone. */
function describeCall(call: Pick<HeldToolCall, "toolName" | "touches">): string {
  return call.touches === null ? call.toolName : `${call.toolName}: ${call.touches}`;
}

/**
 * The stop a held call waits on: an approval naming the tool, what it touches
 * and the folder, with *Allow for this run* as an extra yes.
 *
 * @param call The held call.
 */
export function toolApprovalStop(call: HeldToolCall): SuspendForUserOptions<"approval"> {
  const lines = [
    `The run wants to use **${call.toolName}**${call.touches === null ? "" : ` on \`${call.touches}\``}, in \`${call.cwd}\`.`,
    "",
    "Allow runs it once. Allow for this run lets the same call through for the rest of this run. Deny tells the run it may not.",
  ];
  return {
    kind: "approval",
    title: `Allow ${call.toolName}?`,
    prompt: lines.join("\n"),
    resumeSchema: toolApprovalYesSchema,
    data: {
      tool: call.toolName,
      touches: call.touches,
      cwd: call.cwd,
      approveOptions: [ALLOW_FOR_RUN],
    },
  };
}

/**
 * How many times one try's run is resumed for a tool approval's answer.
 * Each costs a harness restart, so a run past it is asking for more than a
 * user should click through; the try fails, saying so. Shared by every flow
 * that holds a run's tool calls, so they stop at the same bound.
 */
export const MAX_APPROVAL_STEPS = 25;

/**
 * How a resumed session is told a held call was not allowed: the closing words
 * of {@link toolApprovalOutcome}'s prompt on a no or at the deadline.
 */
export const TOOL_NOT_ALLOWED = "Don't make it again; go on without it.";

/** What a person's answer to a held call means for the run. */
export interface ToolApprovalOutcome {
  /** The grant a yes leaves on the run, or `null` for a no. */
  grant: ToolGrant | null;
  /** The line the resumed session is handed. */
  prompt: string;
}

/**
 * Read a held call's answer: a yes grants the call (`once`, or for the run
 * with {@link ALLOW_FOR_RUN}'s data); a no, or nobody answering by the
 * deadline, tells the session it may not, with the person's note when they
 * gave one (`{ note }` on the no).
 *
 * @param answer The stop's answer, not cancelled (a cancel resumes nothing).
 * @param call The held call.
 */
export function toolApprovalOutcome(
  answer: Exclude<ApprovalAnswer, { cancelled: true }>,
  call: HeldToolCall,
): ToolApprovalOutcome {
  const named = describeCall(call);
  if (answer.approved) {
    const forRun = toolApprovalYesSchema.safeParse(answer.answer ?? {}).data?.scope === "run";
    return {
      grant: { toolName: call.toolName, key: call.key, scope: forRun ? "run" : "once" },
      prompt:
        `A person allowed your call (${named})` +
        (forRun ? ", and the same call again for the rest of this run." : ".") +
        " Make the call again now; it will run.",
    };
  }
  if (answer.deadline) {
    return {
      grant: null,
      prompt: `Nobody answered your call (${named}) in time, so it was not allowed. ${TOOL_NOT_ALLOWED}`,
    };
  }
  const note = (answer.answer as { note?: unknown } | null | undefined)?.note;
  const said = typeof note === "string" && note.trim() !== "" ? ` They said: ${note.trim()}` : "";
  return {
    grant: null,
    prompt: `A person did not allow your call (${named}).${said} ${TOOL_NOT_ALLOWED}`,
  };
}
