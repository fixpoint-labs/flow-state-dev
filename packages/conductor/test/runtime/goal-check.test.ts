/**
 * The goal runner's own reporting — what an operator is told a run was.
 *
 * `tick.test.ts` covers the verdicts and what they release. What is left, and
 * what lives here, is the half nothing downstream can check: a `not-run` reason
 * is prose, and prose that names a command nobody could have run sends whoever
 * reads it to reproduce something other than the failure.
 */

import { describe, expect, it } from "vitest";

import { runGoalCheckCommand } from "../../src/runtime/goal-check";
import { shellWords } from "../shell";

/**
 * The rendered command out of a `not-run` reason.
 *
 * Every reason wraps it in backticks, which is the only structure the string
 * has and enough to pull it back out.
 */
function quotedCommand(reason: string): string {
  const match = /`([^`]+)`/.exec(reason);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("a goal command that never ran", () => {
  /**
   * **The command in the reason must be the command that was spawned.**
   *
   * Conductor spawns the declared argv with `shell: false`, so no element of it
   * is ever parsed — but the reason is read by a person, who will paste it into
   * a shell to reproduce the failure. Joined on spaces, a command like
   * `["bash", "-lc", "pnpm tsx goals/run-for-issue.mts"]` reads back as `bash
   * -lc pnpm`, and the operator debugs a program conductor never started.
   */
  it("names a command a shell splits back into the argv that was spawned", async () => {
    const command = [
      "/nonexistent/goal-runner",
      "-lc",
      "pnpm tsx goals/run-for-issue.mts --report 'all cases'",
    ];

    const outcome = await runGoalCheckCommand({
      goalCheck: { command, timeoutMs: 10_000 },
      cwd: process.cwd(),
      entityId: "FIX-1",
    });

    expect(outcome.kind).toBe("not-run");
    const reason = outcome.kind === "not-run" ? outcome.reason : "";
    await expect(shellWords(quotedCommand(reason))).resolves.toEqual(command);
  });
});
