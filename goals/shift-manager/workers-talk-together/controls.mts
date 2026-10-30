/**
 * The closure's controls (FIX-2242). Five are the children's own patches,
 * reused as they are on `main`; `call-holds-session` is new, the one
 * collision no child's control breaks. Each runs the scenes it needs, and
 * the assertion it names must go red on what it grades. Today's `main`
 * before FIX-2238 is the sixth, run with `GOAL_COMMIT=e2c190e`.
 */
import type { ModulePatch } from "../../lib/module-patch.mts";
import { CONTROLS as CHILD } from "../workers-message-each-other/controls.mts";

export const SCENES = ["ac", "ed", "b", "sweep", "j1"] as const;
export type Scene = (typeof SCENES)[number];

export const CONTROL_NAMES = ["no-debt", "held-after-wait", "task-to-conversation", "no-question-message", "no-hop-cap", "call-holds-session"] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the scenes it runs, the assertion that must fail, its patches and what it breaks. */
export interface Control {
  name: ControlName;
  scenes: Scene[];
  assertion: string;
  patches: ModulePatch[];
  does: string;
}

export const CONTROLS: Record<ControlName, Control> = {
  // FIX-2240's: the send owes no wake, so the crashed call is never sent again.
  "no-debt": { name: "no-debt", scenes: ["ac"], assertion: "c:lands-once", patches: CHILD["no-debt"].patches, does: CHILD["no-debt"].does },
  // FIX-2318's: a wait that ends at its deadline doesn't say so, so its late answer never lands.
  "held-after-wait": {
    name: "held-after-wait",
    scenes: ["ed"],
    assertion: "e:kept-once",
    patches: CHILD["held-after-wait"].patches,
    does: CHILD["held-after-wait"].does,
  },
  // FIX-2160's: a { task } message lands in the conversation that filed the task.
  "task-to-conversation": {
    name: "task-to-conversation",
    scenes: ["b"],
    assertion: "b:in-task-session",
    patches: CHILD["task-to-conversation"].patches,
    does: CHILD["task-to-conversation"].does,
  },
  // FIX-2241's (every-stop-is-one-inbox-item/controls.mts): a board tells no filer its task's question.
  "no-question-message": {
    name: "no-question-message",
    scenes: ["ed"],
    assertion: "e:filer-hears",
    patches: [
      {
        module: "packages/workforce/src/conversation-board/delivery.ts",
        from: String.raw`const tell = midwayQuestionTellerOf\(`,
        to: "const tell = undefined && midwayQuestionTellerOf(",
      },
    ],
    does: "a board tells no filer its task's midway question",
  },
  // FIX-2238's: an exchange of worker messages has no budget.
  "no-hop-cap": { name: "no-hop-cap", scenes: ["ed"], assertion: "d:seventh-refused", patches: CHILD["no-hop-cap"].patches, does: CHILD["no-hop-cap"].does },
  // New: a parked call keeps its session's place, so a question to the filer waits for the call to end.
  "call-holds-session": {
    name: "call-holds-session",
    scenes: ["ed"],
    assertion: "e:heard-while-calling",
    patches: [
      {
        module: "packages/workforce/src/messages/wait-for-reply.ts",
        from: String.raw`const outcome = await waitOnRequest\(ctx, \{`,
        to: "await new Promise((resolve) => setTimeout(resolve, Math.max(0, deadlineAt - Date.now()))); $&",
      },
    ],
    does: "a call holds its turn in-process until its deadline instead of parking on the wait gate, so its session stays busy",
  },
};
