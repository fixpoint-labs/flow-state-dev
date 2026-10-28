/**
 * The closure's controls: scratch patches to the code under test, applied as it loads
 * (`goals/lib/module-patch.mts`) in the goal and in every Lab it serves, printed by the run,
 * and refused when they never reached the code. Each must fail the assertions it names; one
 * that leaves any of them green is reported `control:broken`.
 */
import type { ModulePatch } from "../../lib/module-patch.mts";

export interface Control {
  name: string;
  /** The legs it runs. */
  legs: string[];
  mustFail: string[];
  patches: ModulePatch[];
}

const control = (name: string, c: Omit<Control, "name">): Control => ({ name, ...c });

export const CONTROLS: Record<string, Control> = {
  // FIX-2129's: the Inbox answers through the public resume route, which refuses a task run's stop.
  "public-resume": control("public-resume", {
    legs: ["a", "b"],
    mustFail: ["b:approval-same-attempt"],
    patches: [{ module: "packages/client/src/client.ts", from: String.raw`\$\{base\}/answer`, to: "${base}/resume" }],
  }),
  // FIX-2132's: both ways an owed turn starts count it a new attempt.
  "new-attempt": control("new-attempt", {
    legs: ["a", "b"],
    mustFail: ["b:coding-same-attempt"],
    patches: [
      { module: "packages/orchestration/src/tasks/collection/internal.ts", from: String.raw`const turnOnly = !recovering && owesTurn\(task as Task\);`, to: "const turnOnly = false;" },
      {
        module: "packages/orchestration/src/tasks/collection/internal.ts",
        from: String.raw`\.\.\.\(takesTurn \? \{ turn: \(task\.turn \?\? 0\) \+ 1, turnOwed: undefined \} : \{\}\),`,
        to: "...(takesTurn ? { turn: (task.turn ?? 0) + 1, turnOwed: undefined, attempts: task.attempts + 1 } : {}),",
      },
    ],
  }),
  // New: the cancel is written, but neither the suspension nor the row's holds are resolved.
  "cancel-keeps-item": control("cancel-keeps-item", {
    legs: ["c"],
    mustFail: ["c:item-closes", "c:held-cancel-closes-questions"],
    patches: [
      { module: "packages/orchestration/src/tasks/helpers/user-stop.ts", from: String.raw`openHolds\(row\)\.find\(isSuspensionHold\)`, to: "undefined" },
      { module: "packages/orchestration/src/tasks/helpers/user-stop.ts", from: String.raw`if \(stop === undefined \|\| resumeWait === undefined\) return false;`, to: "return false;" },
      { module: "packages/orchestration/src/tasks/collection/holds.ts", from: String.raw`row\.holds\.length === 0 \|\| isTerminalStatus\(row\.status\)\) return \[\];`, to: "row.holds.length === 0) return [];" },
    ],
  }),
  // New: a steer starts its turn whatever holds the row.
  "steer-ignores-mark": control("steer-ignores-mark", {
    legs: ["d"],
    mustFail: ["d:no-request-beside"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/board.ts",
        from: String.raw`after\?\.waitingOn === "steer" && after\.assignee !== undefined`,
        to: 'after?.status === "in_progress" && after.assignee !== undefined',
      },
    ],
  }),
  // FIX-2241's: a board tells no filer its task's question.
  "no-question-message": control("no-question-message", {
    legs: ["j1"],
    mustFail: ["j1:filer-hears", "j1b:coder-heard"],
    patches: [
      {
        module: "packages/workforce/src/conversation-board/delivery.ts",
        from: String.raw`const tell = midwayQuestionTellerOf\(`,
        to: "const tell = undefined && midwayQuestionTellerOf(",
      },
    ],
  }),
  // FIX-2129's: a stop with no deadline gets 1.5 s anyway.
  "default-deadline": control("default-deadline", {
    legs: ["a"],
    mustFail: ["a:no-deadline-waits"],
    patches: [{ module: "packages/core/src/types/wait-for-user.ts", from: String.raw`options\.deadline \?\? ctx\.requestHost\?\.userDeadlineMs`, to: "options.deadline ?? ctx.requestHost?.userDeadlineMs ?? 1500" }],
  }),
};
