import { memo } from "react";
import { isSuspensionWait, type ToolOutputItem } from "@flow-state-dev/core/items";
import { toolIntent, toolSubject } from "./flow-state/tool-naming";
import { composeToolGroupLabel, toolRunOpen, toolRunState, toolStepState, withToolState, type ToolCallStatus, type ToolStepStatus } from "./flow-state/tool-grouping";
import { cn } from "../lib/utils";

/**
 * A turn's tool calls as the lab draws them, in the UI registry's words
 * (`tool-naming`, `tool-grouping`): one call as a step, "Read …/src/a.ts",
 * and a steps line's calls as one run that opens to each. The conversation
 * and a popup draw a steps line (`StepsLine`, in `lines.tsx`) the same way.
 * The thinking between the calls is not drawn.
 */

/** One tool call as a step: what it did, the tool, how it stands, and the turn that made it. */
export interface ToolStep {
  id: string;
  text: string;
  /** The tool's own name, which a run of steps is summed up by. */
  tool: string;
  /** A shell command, shown as code. */
  code?: boolean;
  state: ToolStepStatus;
  requestId: string;
}

/** A run of steps as one line: what it did, how it stands, and whether it shows open (open while it runs). */
export interface StepRun {
  label: string;
  state: ToolStepStatus;
  open: boolean;
}

/** A call's status as the registry reads it: parked on you waits, and one still running in a turn that is over (`ended`) failed. */
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

/** One line for a run of steps, in the UI registry's words. */
export function stepRun(steps: readonly ToolStep[]): StepRun {
  const states = steps.map((step) => step.state);
  const state = toolRunState(states);
  const now = state === "running" ? [...steps].reverse().find((step) => step.state === "running") : undefined;
  const label =
    steps.length === 1
      ? withToolState(steps[0]!.text, state)
      : now !== undefined
        ? withToolState(now.text, "running")
        : withToolState(composeToolGroupLabel(steps.map((step) => step.tool)), state, states.filter((s) => s === state).length, steps.length);
  return { label, state, open: toolRunOpen(state) };
}

/** A steps line's calls as steps; the thinking between them is left out. `ended` once their turn is over. */
export function stepsOf(items: readonly { type: string }[], ended = false): ToolStep[] {
  return items.flatMap((item) => (item.type === "tool_output" ? [stepOf(item as ToolOutputItem, ended)] : []));
}

/**
 * A run of tool steps: one step as its own line, several as one line ("Read
 * 2 files and searched the code") that opens to each. Open while it runs,
 * folded once it isn't; opened or closed by hand, it stays so until its state
 * changes. A failed step says "(failed)" in words, in the lab's red.
 */
export const ToolRun = memo(function ToolRun({ steps }: { steps: readonly ToolStep[] }) {
  if (steps.length === 0) return null;
  const run = stepRun(steps);
  const tone = run.state === "error" ? "text-destructive" : "text-muted-foreground";
  if (steps.length === 1) {
    return (
      <div data-step="tool" data-state={run.state} className={cn("text-xs", tone)}>
        <ToolText step={steps[0]!} />
      </div>
    );
  }
  return (
    <details open={run.open} data-step="tools" data-state={run.state} className="text-xs text-muted-foreground">
      <summary className={cn("cursor-pointer", tone)}>{run.label}</summary>
      <ol className="mt-1 pl-4">
        {steps.map((step) => (
          <li key={step.id} data-state={step.state} className={step.state === "error" ? "text-destructive" : undefined}>
            · <ToolText step={step} />
          </li>
        ))}
      </ol>
    </details>
  );
});

/** What one tool step did, with how it stands after it ("…", "(failed)"); a shell command is shown as the code it ran. */
function ToolText({ step }: { step: ToolStep }) {
  const state = withToolState("", step.state);
  return (
    <>
      {step.code ? <code className="font-mono">{step.text}</code> : step.text}
      {state === "" ? null : state === "…" ? state : ` ${state.trim()}`}
    </>
  );
}
