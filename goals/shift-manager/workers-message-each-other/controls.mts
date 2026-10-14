/**
 * The goal's six controls, each one scratch patch to one Workforce module,
 * applied as the process under test loads it (`goals/lib/module-patch.mjs`).
 * Nothing is written to the checkout, and nothing here is committed code.
 *
 * Each patch's anchor reads the same in the TypeScript source and in tsx's
 * JavaScript output; the hook throws when it matches nothing, and marks a
 * file when it applied, so a control that never reached the served code fails
 * the run instead of passing on it.
 */
import { describePatches, modulePatchEnv } from "../../lib/module-patch.mts";

export const CONTROL_NAMES = ["no-wake", "drop-ended", "no-hop-cap", "no-roster-check", "fresh-hop-on-task", "memory-log"] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the legs it runs, the assertion that must go red, and its patch. */
export interface Control {
  name: ControlName;
  /** The legs it runs: the one it must fail, and any that leg needs first. */
  legs: string[];
  /** The assertion, by name, that must go red. */
  assertion: string;
  module: string;
  from: string;
  to: string;
  does: string;
}

const MESSAGES = "packages/workforce/src/messages";

export const CONTROLS: Record<ControlName, Control> = {
  "no-wake": {
    name: "no-wake",
    legs: ["1"],
    assertion: "1:answer-holds-codename",
    module: `${MESSAGES}/worker-message-entry.ts`,
    from: String.raw`act: "wake-turn",`,
    to: 'act: "line",',
    does: "a message lands as a line in the recipient's conversation and never wakes its turn",
  },
  "drop-ended": {
    name: "drop-ended",
    legs: ["2"],
    assertion: "2:lands-in-own-conversation",
    module: `${MESSAGES}/send-message.ts`,
    from: String.raw`const fromTaskOrPost = typeof state\[TASK_ID_STATE_KEY\] === "string" \|\| typeof state\[FILING_SESSION_STATE_KEY\] === "string";`,
    to: "const fromTaskOrPost = false;",
    does: "an answer to a message sent from a task's session goes back to that session, whose turn has ended, not to the sender's own conversation",
  },
  "no-hop-cap": {
    name: "no-hop-cap",
    legs: ["3"],
    assertion: "3:ring-stops-at-6",
    module: `${MESSAGES}/send-message.ts`,
    from: String.raw`if \(hop > limits\.hopLimit\) \{`,
    to: "if (false) {",
    does: "a chain of worker messages has no hop limit (the per-turn limit stays)",
  },
  "no-roster-check": {
    name: "no-roster-check",
    legs: ["4"],
    assertion: "4:bobs-worker-refused",
    module: `${MESSAGES}/send-message.ts`,
    from: String.raw`const recipient = await installation\.rosterWorker\(ctx(?: as never)?, input\.to\);`,
    to: 'const recipient = (await installation.rosterWorker(ctx, input.to)) ?? { id: input.to, flow: "agent", standard: false, description: null, delegates: [] };',
    does: "a worker that isn't on the sender's user's roster is taken as one of theirs on `agent`",
  },
  "fresh-hop-on-task": {
    name: "fresh-hop-on-task",
    legs: ["3b"],
    assertion: "3b:hop-2",
    module: "packages/workforce/src/conversation-board/board.ts",
    from: String.raw`\[MESSAGE_HOP_STATE\]: sessionHopOf\(ctx\.session\.state\)`,
    to: "[MESSAGE_HOP_STATE]: 0",
    does: "a task's session starts its message hop count at 0, not at the count of the turn that filed it",
  },
  "memory-log": {
    name: "memory-log",
    legs: ["1", "5"],
    assertion: "5:lists-every-message",
    module: `${MESSAGES}/message-log.ts`,
    from: String.raw`export function messageLogOf\(ctx[^)]*\)[^{]*\{`,
    to:
      "const __memoryLog = new Map(); " +
      "const __memoryRef = (id) => ({ get state() { return __memoryLog.get(id); }, patchState: async (patch) => { __memoryLog.set(id, { ...__memoryLog.get(id), ...patch }); } }); " +
      "export function messageLogOf(ctx) { return { getOptional: async (id) => (__memoryLog.has(id) ? __memoryRef(id) : undefined), getOrCreate: async (id, initial) => { if (!__memoryLog.has(id)) __memoryLog.set(id, initial); return __memoryRef(id); } }; } " +
      "function __storedMessageLogOf(ctx) {",
    does: "the message log is kept in the server's memory, not in the store",
  },
};

/** The environment that applies `control` to the served checkout at `root`, marking `mark` when it loads. */
export function controlEnv(control: Control, root: string, mark: string): Record<string, string> {
  return modulePatchEnv([control], root, mark);
}

/** The patch in full, for the run's log. */
export function describeControl(control: Control, root: string): string {
  return describePatches([control], root);
}
