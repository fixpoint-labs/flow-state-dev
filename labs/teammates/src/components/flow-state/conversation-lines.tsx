"use client";

/**
 * The lines a conversation draws for a turn that didn't finish, a run of
 * tool calls, and a wait for the person's yes, for any conversation screen.
 *
 * React's conversation model (`conversationLines`) decides what each line
 * is; these decide how it looks. Spread {@link conversationLineRenderers}
 * into a registry and name how a steps line draws:
 *
 *     const renderers = { ...chatAssistantRenderers, ...conversationLineRenderers };
 *     <LineContext.Provider value={{ who: "Ada", retry, stillRunning, canAnswer: true }}>
 *       <ItemsRenderer lines={lines} toolGroupRenderer={ToolGroup} />
 *     </LineContext.Provider>
 *
 * - failed: the turn's reason under `who`, with Retry when the model offers
 *   it (`line.retryable`) and the screen can run it (`retry`).
 * - stopped: *Interrupted by you*, and the background work still running
 *   when the screen says so (`stillRunning`), with View (`onViewRunning`).
 * - approval: a `user_approval` wait as the registry's approval card, with
 *   its answer once it has one (`line.resolution`). Approve and Reject only
 *   where the screen answers (`canAnswer`). Any other wait draws nothing
 *   here; register another `suspension` renderer to draw those.
 * - steps: the `tool` item's `ToolGroup` is the steps line's look;
 *   {@link CompactSteps} is its compact one, one small line that opens to
 *   each call, for a dense thread. Both read a call the agent redid as tried.
 *
 * What a line can do comes from {@link LineContext}, which the screen sets.
 * Every field is optional: a line outside a provider draws with no action.
 * `workforce-lines` reads the same context for its names, avatars and links.
 */

import { createContext, memo, useContext, type ReactNode } from "react";
import { isSuspensionWait, type ErrorItem, type FileContent, type SuspensionItem, type ToolOutputItem } from "@flow-state-dev/core/items";
import type { ItemLine, RendererRegistry } from "@flow-state-dev/react";
import { suspendForUserKindOf } from "@flow-state-dev/core/types";
import { cn } from "@/lib/utils";
import { Approval } from "./approval";
import { RequestRecovery } from "./request-recovery";
import { composeToolGroupLabel, toolRunOpen, toolRunState, toolStepState, triedLabel, withRedone, withToolState, type ToolCallStatus, type ToolStepStatus } from "./tool-grouping";
import { toolIntent, toolSubject } from "./tool-naming";

/** What a line can do on the screen it is drawn on. Each field says which lines read it. */
export type LineContextValue = {
  /** Who works in this conversation, by name. Failed (before its reason), approval (over the card). */
  who?: string;
  /** A worker's name by its id. Workforce's sent, received and result lines. */
  nameOf?: (id: string) => string;
  /** A worker's picture by its id. Workforce's sent, received and result lines. */
  avatarOf?: (id: string) => ReactNode;
  /** Open a task. Workforce's result line, and an app's own task card. */
  openTask?: (taskId: string) => void;
  /** Open the exchange a sent message started. Workforce's sent line. */
  openMessage?: (sent: { to: string; messageId: string; text: string }) => void;
  /** How a sent message stands now ("replied", "working"), by its id; `undefined` shows nothing. Workforce's sent line. */
  sentStatusOf?: (messageId: string) => string | undefined;
  /** Run a failed turn again. Failed, when the model offers Retry; give it only while the screen can. */
  retry?: (requestId: string) => Promise<unknown>;
  /** The background work still running, by the stopped line's id ({@link stillRunningLine} says which); `undefined` says nothing. Stopped. */
  stillRunning?: (lineId: string) => number | undefined;
  /** Show where that work is listed. Stopped, as View beside the count. */
  onViewRunning?: () => void;
  /** This screen answers a wait for the person's yes. Approval. */
  canAnswer?: boolean;
  /** Read a file's bytes, for its thumbnail. An app's own message line, and the brief's. */
  readFile?: (file: FileContent, url: string) => Promise<Blob>;
};

/** The screen a line is drawn on. Outside a provider, every line draws with no action. */
export const LineContext = createContext<LineContextValue>({});

/** The line context of the screen drawing this line. */
export const useLineContext = (): LineContextValue => useContext(LineContext);

/** A turn that failed: why, under `who`, and Retry when the model offers it and the screen can run it. */
export function FailedLine({ item, line }: { item: ErrorItem; line?: ItemLine }) {
  const { who, retry } = useLineContext();
  const offered = line?.kind === "failed" && line.retryable && retry !== undefined;
  return (
    <div data-line="failed">
      <RequestRecovery
        {...(who === undefined ? {} : { who })}
        reason={item.message}
        code={item.code}
        details={item.details}
        {...(offered ? { onRetry: () => retry(item.requestId) } : {})}
      />
    </div>
  );
}

/**
 * The stopped line that may say what still runs: the conversation's last
 * line, when it is a stopped one and no turn is running. What still runs is
 * the session's now, so an older stop, or one a later turn has run past, says
 * nothing of it. A screen's `stillRunning` answers for this line only.
 */
export function stillRunningLine(lines: readonly ItemLine[], running: boolean): string | undefined {
  const last = lines.at(-1);
  return last?.kind === "stopped" && !running ? last.id : undefined;
}

/** A turn the person stopped, after its last line, with the work still running when the screen says so. */
export function StoppedLine({ line }: { line: ItemLine }) {
  const { stillRunning, onViewRunning } = useLineContext();
  const running = stillRunning?.(line.id);
  return (
    <div data-line="stopped">
      <RequestRecovery stopped {...(running === undefined ? {} : { stillRunning: running })} {...(onViewRunning === undefined ? {} : { onView: onViewRunning })} />
    </div>
  );
}

/** A wait for the person's yes, answered or not. Any other wait draws nothing here. */
export function ApprovalLine({ item, line }: { item: SuspensionItem; line?: ItemLine }) {
  const { who, canAnswer } = useLineContext();
  if (suspendForUserKindOf(item) !== "approval") return null;
  const resolution = line?.kind === "suspension" ? line.resolution : undefined;
  return (
    <section aria-label={`${who ?? "The agent"} asks`} data-line="approval" data-resolution={resolution ?? "waiting"}>
      <Approval item={item} isResolved={resolution !== undefined} resolution={resolution} canAnswer={canAnswer === true} />
    </section>
  );
}

/** One tool call as a compact step: what it did, the tool, and how it stands. */
export type ToolStep = {
  id: string;
  text: string;
  /** The tool's own name, which a run of steps is summed up by. */
  tool: string;
  /** A shell command, shown as code. */
  code?: boolean;
  state: ToolStepStatus;
  /** A failed call a later call of the same tool got through: it reads "Tried …". */
  redone?: boolean;
  requestId: string;
};

/** A run of steps as one line: what it did, how it stands, and whether it shows open (open while it runs). */
export type StepRun = { label: string; state: ToolStepStatus; open: boolean };

/** A call's status as the registry reads it: parked on the person waits, and one still running in a turn that is over (`ended`) failed. */
function callStatus(call: ToolOutputItem, ended: boolean): ToolCallStatus {
  if (isSuspensionWait(call)) return "waiting";
  if (call.status === "in_progress") return ended ? "failed" : "running";
  // A call that never finished (`incomplete`) did not work.
  return call.status === "completed" ? "done" : "failed";
}

/** A call's arguments, or none when they don't parse. */
function argsOf(call: ToolOutputItem): Record<string, unknown> {
  try {
    return JSON.parse(call.toolCall.arguments || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * A tool call as a step: what it said it was doing, else what it acted on,
 * with its result once it has one, else the tool it used; and how it stands,
 * a refused call failed as a thrown one is.
 */
export function stepOf(call: ToolOutputItem, ended = false): ToolStep {
  const tool = call.toolCall.name;
  const args = argsOf(call);
  const status = callStatus(call, ended);
  const output = status === "done" ? call.output : undefined;
  const intent = toolIntent(tool, args);
  const subject = intent === undefined ? toolSubject(tool, args, output) : undefined;
  return {
    id: call.id,
    tool,
    text: intent ?? subject?.text ?? `Used ${tool}`,
    ...(subject?.code ? { code: true } : {}),
    state: toolStepState(status, tool, output),
    requestId: call.requestId,
  };
}

/** A steps line's calls as steps, a redone call marked; the thinking between them is left out. `ended` once their turn is over. */
export function stepsOf(items: readonly { type: string }[], ended = false): ToolStep[] {
  return withRedone(items.flatMap((item) => (item.type === "tool_output" ? [stepOf(item as ToolOutputItem, ended)] : [])));
}

/** One line for a run of steps, in the registry's words. */
export function stepRun(steps: readonly ToolStep[]): StepRun {
  const states = steps.map((step) => step.state);
  const state = toolRunState(states);
  const now = state === "running" ? [...steps].reverse().find((step) => step.state === "running") : undefined;
  const label =
    steps.length === 1
      ? steps[0]!.redone
        ? triedText(steps[0]!)
        : withToolState(steps[0]!.text, state)
      : now !== undefined
        ? withToolState(now.text, "running")
        : withToolState(composeToolGroupLabel(steps.map((step) => step.tool)), state, states.filter((s) => s === state).length, steps.length);
  return { label, state, open: toolRunOpen(state) };
}

/** A redone step's words: the tool's own name when the call said nothing of what it did ("Tried openWorkstream"). */
const triedText = (step: ToolStep) => triedLabel(step.text === `Used ${step.tool}` ? step.tool : step.text);

/** What one step did, with how it stands after it ("…", "(failed)"); a shell command is shown as the code it ran. */
function StepText({ step }: { step: ToolStep }) {
  if (step.redone) return <>{triedText(step)}</>;
  const state = withToolState("", step.state);
  return (
    <>
      {step.code ? <code className="font-mono">{step.text}</code> : step.text}
      {state === "" ? null : state === "…" ? state : ` ${state.trim()}`}
    </>
  );
}

/**
 * A steps line's calls, compact: one call as its own small line, several as
 * one line ("Read 2 files and searched the code") that opens to each. Open
 * while it runs, folded once it isn't. A failed call says "(failed)" in
 * words; the thinking between the calls is not drawn.
 */
export const CompactSteps = memo(function CompactSteps({ items, line }: { items: readonly { type: string }[]; line?: Extract<ItemLine, { kind: "steps" }> }) {
  const steps = stepsOf(items, line?.ended === true);
  if (steps.length === 0) return null;
  const run = stepRun(steps);
  const tone = run.state === "error" ? "text-destructive" : "text-muted-foreground";
  if (steps.length === 1) {
    return (
      <div data-line="steps" data-step="tool" data-state={run.state} className={cn("text-xs", tone)}>
        <StepText step={steps[0]!} />
      </div>
    );
  }
  return (
    <details open={run.open} data-line="steps" data-step="tools" data-state={run.state} className="text-xs text-muted-foreground">
      <summary className={cn("cursor-pointer", tone)}>{run.label}</summary>
      <ol className="mt-1 pl-4">
        {steps.map((step) => (
          <li key={step.id} data-state={step.state} className={step.state === "error" ? "text-destructive" : undefined}>
            · <StepText step={step} />
          </li>
        ))}
      </ol>
    </details>
  );
});

/**
 * The failed, stopped and approval lines for a registry. Spread them after
 * the registry's own, so they win: `{ ...chatAssistantRenderers, ...conversationLineRenderers }`.
 * A screen that draws other waits too sets its own `suspension` after.
 */
export const conversationLineRenderers = {
  error: FailedLine,
  stopped: StoppedLine,
  suspension: ApprovalLine,
} satisfies RendererRegistry;
