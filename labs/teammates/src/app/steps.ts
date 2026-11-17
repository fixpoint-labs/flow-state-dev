/**
 * A session's items as the steps a popup draws, and a run of tool calls as
 * one line, in the UI registry's words (`tool-naming`, `tool-grouping`).
 */
import { isSuspensionWait } from "@flow-state-dev/core/items";
import { RECEIVED_MESSAGE_DATA_TYPE, SEND_MESSAGE_TOOL } from "@flow-state-dev/workforce/browser";
import { toolIntent, toolSubject } from "../components/flow-state/tool-naming";
import {
  composeToolGroupLabel,
  knownToolVerbs,
  toolRunOpen,
  toolRunState,
  toolStepState,
  withToolState,
  type ToolCallStatus,
  type ToolStepStatus,
} from "../components/flow-state/tool-grouping";
import { durationText } from "../components/flow-state/spend";
import { parseArgs, sentTo, textOf, type Item } from "./items";

/**
 * One step of a session as a popup draws it: a line given to the worker (a
 * task's brief, or a message), what the worker wrote, a message it sent, a
 * tool it ran, or the harness a coding run went through.
 */
export interface SessionStep {
  id: string;
  kind: "given" | "said" | "sent" | "tool" | "harness";
  text: string;
  /** For `sent`, the worker it went to. */
  to?: string;
  /** For `tool`, the tool's own name, which a run of steps is summed up by. */
  tool?: string;
  /** For `tool`, the step is a shell command, shown as code. */
  code?: boolean;
  /** For `tool`, how it stands: running, waiting, done, or failed (thrown, or a result that says so). */
  state?: ToolStepStatus;
  /** For `tool`, the request (turn) that made the call: a task's session holds every attempt's. */
  requestId?: string;
  /** For `said`, while it is still being written. */
  streaming?: boolean;
}

/**
 * A run of tool steps as one line: what it did ("Read 2 files and searched
 * the code"; the step in flight while it runs, "Read src/a.ts…"), how it
 * stands, and whether it shows open. Open while it runs, folded once it
 * doesn't: the registry's `toolRunOpen`.
 */
export interface StepRun {
  label: string;
  state: ToolStepStatus;
  open: boolean;
}

/** One line for a run of tool steps, in the UI registry's words: {@link StepRun}. */
export function stepRun(steps: readonly SessionStep[]): StepRun {
  const states = steps.map((step) => step.state ?? "completed");
  const state = toolRunState(states);
  const now = state === "running" ? [...steps].reverse().find((step) => step.state === "running") : undefined;
  const label =
    steps.length === 1
      ? withToolState(steps[0]!.text, state)
      : now !== undefined
        ? withToolState(now.text, "running")
        : withToolState(composeToolGroupLabel(steps.map((step) => step.tool ?? step.text)), state, states.filter((s) => s === state).length, steps.length);
  return { label, state, open: toolRunOpen(state) };
}

/** A tool the registry's words call running a command: each harness's shell tool. */
const isCommand = (tool: string | undefined) => tool !== undefined && knownToolVerbs(tool)?.singular === "ran a command";

/**
 * How many shell commands a run's steps ran, done or failed; one still running
 * isn't counted. Known by the tool's name in the registry's vocabulary, the
 * one the step groups' "ran 3 commands" already uses. Given the run's request,
 * only that request's calls count: a retry runs in the same session.
 */
export function commandsRun(steps: readonly SessionStep[], requestId?: string): number {
  return steps.filter(
    (step) =>
      step.kind === "tool" &&
      isCommand(step.tool) &&
      (step.state ?? "completed") !== "running" &&
      (requestId === undefined || step.requestId === undefined || step.requestId === requestId),
  ).length;
}

/** What a coding task's popup says the run did: the files it recorded, its commands, and how long it took. */
export interface RunSummary {
  /** The files the run's harness recorded touching; `null` when the harness records none (Codex and Cursor today). */
  files: { count: number; truncated: boolean } | null;
  commands: number;
  /** Only once the task ended. */
  durationMs?: number;
}

/**
 * "Edited 2 files · ran 5 commands · 2m 14s", with what the run didn't do
 * left out, and no file part for a harness that records none (never "0
 * files"). Empty when there is nothing to say.
 */
export function runSummaryLine({ files, commands, durationMs }: RunSummary): string {
  const n = files?.count ?? 0;
  const parts = [
    n === 0 ? null : `edited ${n}${files?.truncated ? "+" : ""} file${n === 1 && !files?.truncated ? "" : "s"}`,
    commands === 0 ? null : `ran ${commands} command${commands === 1 ? "" : "s"}`,
    durationMs === undefined ? null : durationText(durationMs),
  ].filter((p): p is string => p !== null);
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The harness a run's items came from, by the block that emitted them: each harness block's own name, which the host keeps. */
const HARNESS_LABEL: Record<string, string> = { "claude-code-agent": "Claude Code", "codex-agent": "Codex", "cursor-agent": "Cursor" };

/**
 * A tool call's status as the registry reads it: a call parked on an approval
 * or a question waits, and one still marked running in a turn that is over
 * (`ended`) failed.
 */
function callStatus(item: Item, ended: readonly string[]): ToolCallStatus {
  if (isSuspensionWait(item as never)) return "waiting";
  if (item.status === "in_progress") return ended.includes(item.requestId) ? "failed" : "running";
  // A call that never finished (`incomplete`) did not work.
  return item.status === "completed" ? "done" : "failed";
}

/**
 * A tool call as a step, in the UI registry's words: what it said it was doing,
 * else what it acted on, with its result once it has one ("Read …/src/a.ts",
 * `Search "x" · 3 matches`, the command it ran), else the tool it used; and how
 * it stands, a refused call failed as a thrown one is. The same on every
 * harness, since the registry names each one's tools.
 */
export function toolStep(item: Item, ended: readonly string[] = []): SessionStep {
  const tool: string = item.toolCall.name;
  const args = parseArgs(item);
  const status = callStatus(item, ended);
  const output = status === "done" ? item.output : undefined;
  const intent = toolIntent(tool, args);
  const subject = intent === undefined ? toolSubject(tool, args, output) : undefined;
  return {
    id: item.id,
    kind: "tool",
    tool,
    text: intent ?? subject?.text ?? `Used ${tool}`,
    ...(subject?.code ? { code: true } : {}),
    state: toolStepState(status, tool, output),
    ...(typeof item.requestId === "string" ? { requestId: item.requestId } : {}),
  };
}

/** A session's items as a popup's steps: what it was given, what it wrote, and the tools it ran. */
export function toSteps(items: readonly Item[]): SessionStep[] {
  const steps: SessionStep[] = [];
  for (const item of items) {
    if (item.type === "message" && textOf(item).trim() !== "") {
      steps.push({ id: item.id, kind: item.role === "user" ? "given" : "said", text: textOf(item), ...(item.status === "in_progress" ? { streaming: true } : {}) });
    } else if (item.type === "data" && item.dataType === RECEIVED_MESSAGE_DATA_TYPE && typeof item.value?.text === "string") {
      steps.push({ id: item.id, kind: "given", text: item.value.text });
    } else if (item.type === "tool_output" && item.toolCall?.name === SEND_MESSAGE_TOOL && sentTo(item) !== undefined) {
      steps.push({ id: item.id, kind: "sent", text: String(parseArgs(item).text ?? ""), to: sentTo(item) ?? "" });
    } else if (item.type === "tool_output" && typeof item.toolCall?.name === "string") {
      steps.push(toolStep(item));
    }
  }
  return steps;
}

/** A coding run's items as steps: the harness it started on, once it reports, then what it did. */
export function runSteps(items: readonly Item[]): SessionStep[] {
  const block = items.find((i) => HARNESS_LABEL[i.provenance?.blockName ?? ""] !== undefined)?.provenance?.blockName;
  return [...(block === undefined ? [] : [{ id: "harness", kind: "harness" as const, text: `Started on ${HARNESS_LABEL[block]}` }]), ...toSteps(items)];
}
