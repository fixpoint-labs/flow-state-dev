/**
 * The closure's controls: scratch patches to the code under test, applied as it loads
 * (`goals/lib/module-patch.mts`) in the goal and in every Lab it serves, printed by the run,
 * and refused when they never reached the code. Each must fail the assertions it names; one
 * that leaves any of them green is reported `control:broken`.
 */
import type { ModulePatch } from "../../lib/module-patch.mts";

export interface Control {
  name: string;
  /** What it breaks, in a line. */
  does: string;
  /** The legs it runs. */
  legs: string[];
  mustFail: string[];
  patches: ModulePatch[];
}

const control = (name: string, c: Omit<Control, "name">): Control => ({ name, ...c });

export const CONTROLS: Record<string, Control> = {
  // FIX-2129's: the Inbox answers through the public resume route, which refuses a task run's stop.
  "public-resume": control("public-resume", {
    does: "the screen's answer goes through the public resume route",
    legs: ["a", "b"],
    mustFail: ["b:approval-same-attempt"],
    patches: [{ module: "packages/client/src/client.ts", from: String.raw`\$\{base\}/answer`, to: "${base}/resume" }],
  }),
  // FIX-2132's: both ways an owed turn starts count it a new attempt.
  "new-attempt": control("new-attempt", {
    does: "an owed turn, the board's claim of it and the admission that takes it, counts as a new attempt",
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
    does: "a cancel is written, but resumes no stop, now or on a later touch, and leaves the row's holds open",
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
    does: "a steer starts the turn it is owed while its task waits on a person",
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
  // FIX-2129's: a stop with no deadline gets 1.5 s anyway.
  "default-deadline": control("default-deadline", {
    does: "a stop for a person with no deadline gets one of 1.5 s",
    legs: ["a"],
    mustFail: ["a:no-deadline-waits"],
    patches: [{ module: "packages/core/src/types/wait-for-user.ts", from: String.raw`options\.deadline \?\? ctx\.requestHost\?\.userDeadlineMs`, to: "options.deadline ?? ctx.requestHost?.userDeadlineMs ?? 1500" }],
  }),
};
