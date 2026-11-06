/**
 * What a turn's tool calls say in a thread, in the UI registry's words: each
 * step names what it acted on ("Read src/billing/ledger.ts",
 * `Search "LEDGER_CODE" · no matches`) and says "(failed)" when its result
 * reports a refusal; a run of steps is one line ("Read 6 files") that opens
 * to them. Never a tool's name, a task id or `null`.
 */
import {
  composeToolCallsLabel,
  type ToolCallStatus,
  type ToolStepState,
  toolRunState,
  toolStepState,
  withToolState,
} from "../components/flow-state/tool-grouping";
import { toolIntent, toolSubject } from "../components/flow-state/tool-naming";

/** One tool call as its item carries it: the tool, its args, its status and its result. */
export interface ToolCallOf {
  id: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  output?: unknown;
}

/** One step of a run: its line and where it stands, and the task it filed when it is a `createTask` that did. */
export interface ToolStep {
  id: string;
  line: string;
  state: ToolStepState;
  taskId?: string;
}

/** A run of steps: the line that sums them, where the run stands, and each step. */
export interface ToolRun {
  label: string;
  state: ToolStepState;
  steps: ToolStep[];
}

/** A call's words without its state: what it says it is doing, else what it acted on, else its verb. */
function said(call: ToolCallOf): string {
  const intent = toolIntent(call.name, call.args) ?? toolSubject(call.name, call.args, call.status === "done" ? call.output : undefined)?.text;
  return composeToolCallsLabel([{ name: call.name, intent }]);
}

/** The task a `createTask` call filed, from its output, or undefined for any other tool or a refused call. */
export function filedTaskOf(call: ToolCallOf): string | undefined {
  if (call.name !== "createTask") return undefined;
  const output = call.output as { ok?: boolean; taskId?: unknown } | undefined;
  return output?.ok === true && typeof output.taskId === "string" ? output.taskId : undefined;
}

/** A run of consecutive calls, as one line that opens to a line per call. */
export function toolRun(calls: readonly ToolCallOf[]): ToolRun {
  const steps = calls.map((call) => {
    const state = toolStepState(call.status, call.name, call.output);
    const taskId = filedTaskOf(call);
    return { id: call.id, line: withToolState(said(call), state), state, ...(taskId === undefined ? {} : { taskId }) };
  });
  const state = toolRunState(steps.map((step) => step.state));
  if (steps.length === 1) return { label: steps[0]!.line, state, steps };
  // Several calls sum up by what they did ("Read 6 files"); each is named once the run opens.
  const summary = composeToolCallsLabel(calls.map((call) => ({ name: call.name, intent: toolIntent(call.name, call.args) })));
  const count = steps.filter((step) => step.state === state).length;
  return { label: withToolState(summary, state, count, steps.length), state, steps };
}
