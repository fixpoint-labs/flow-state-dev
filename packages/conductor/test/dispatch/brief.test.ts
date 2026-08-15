/**
 * Brief assembly and rendering — the interop surface between conductor and a
 * harness that reads prose.
 */

import { describe, expect, it } from "vitest";
import { briefFor, renderBrief } from "../../src/dispatch/brief";
import { issue } from "../fixtures";
import { shellWords } from "../shell";

describe("briefFor", () => {
  it("takes who and where from the entity and what and why from the action", () => {
    const brief = briefFor(
      issue("IMPLEMENTATION"),
      { kind: "addressFeedback", entityId: "FIX-1", because: "CI failed." },
      { dispatchId: "d1", branch: "fix/FIX-1", workspacePath: "/w" },
    );
    expect(brief).toEqual({
      dispatchId: "d1",
      entityId: "FIX-1",
      entityKind: "issue",
      phase: "IMPLEMENTATION",
      action: "addressFeedback",
      branch: "fix/FIX-1",
      workspacePath: "/w",
      guidancePaths: [],
      because: "CI failed.",
      summary: null,
      goalCommand: null,
    });
  });

  it("nulls the reason a phase-entry dispatch has none of, rather than inventing one", () => {
    const brief = briefFor(
      issue("SPEC"),
      { kind: "draftSpec", entityId: "FIX-1" },
      { dispatchId: "d1", branch: "spec/FIX-1", workspacePath: "/w" },
    );
    expect(brief.because).toBeNull();
  });
});

describe("renderBrief", () => {
  const base = briefFor(
    issue("IMPLEMENTATION"),
    { kind: "implement", entityId: "FIX-1", because: "The spec was approved." },
    {
      dispatchId: "d1",
      branch: "fix/FIX-1",
      workspacePath: "/w",
      guidancePaths: ["AGENTS.md", "docs/philosophy.md"],
      summary: "Make the board show costs.",
    },
  );

  it("states the work, the branch, the reason and the reading list", () => {
    const rendered = renderBrief(base);
    expect(rendered).toContain("Implement this work item");
    expect(rendered).toContain("`fix/FIX-1`");
    expect(rendered).toContain("The spec was approved.");
    expect(rendered).toContain("`AGENTS.md`");
    expect(rendered).toContain("Make the board show costs.");
  });

  it("tells a harness not to report back what it produced — GitHub is the authority on that", () => {
    expect(renderBrief(base)).toContain("Conductor reads GitHub for what");
  });

  it("tells a remote harness to do its work on the branch, since it has no checkout waiting", () => {
    expect(renderBrief({ ...base, workspacePath: null })).toContain("do your work on it");
  });

  /**
   * **A brief for a dispatch that writes nothing must not ask for a commit.**
   *
   * Two actions change nothing, and the closing instruction used to tell both to
   * commit and push anyway. For `answerQuestion` that contradicts the intent
   * three lines above it — *do not change the work to do it*. For `runGoalCheck`
   * it is worse than a contradiction: the check stands detached at the merged
   * base with no branch at all, so an agent obeying it either fails outright or
   * pushes a `goal-check/<id>` that flips the next provision onto the re-entry
   * plan and proves the previous run's commits instead of the base.
   */
  it.each([
    ["answerQuestion", "a question is answered without touching the work"],
    ["runGoalCheck", "a goal check stands on the base, on no branch to commit onto"],
  ] as const)("never asks a %s dispatch to commit and push — %s", (action) => {
    const rendered = renderBrief({ ...base, action, branch: null });
    expect(rendered).not.toContain("Commit your work");
    expect(rendered).toContain("leave the working tree as you found it");
  });

  it("still asks work that writes to commit and push", () => {
    expect(renderBrief(base)).toContain("Commit your work on this branch and push it.");
  });

  /**
   * The goal command travels **outward**, so an agent can run the check before
   * it stops rather than handing back work it could have known was unfinished.
   * Nothing reads a brief back — conductor takes the command from its own config
   * every time — so this is information, not a channel.
   */
  it("tells writing work what its goal will be measured by, entity id and all", () => {
    const rendered = renderBrief({ ...base, goalCommand: ["pnpm", "goal"] });
    expect(rendered).toContain("pnpm goal FIX-1");
    expect(rendered).toContain("reads its exit status");
  });

  /**
   * **The command an agent is shown must be the command conductor runs.**
   *
   * The brief tells the agent to run the check before it stops, and conductor
   * spawns the same argv itself with `shell: false` — so an element carrying a
   * space, a quote or a metacharacter means the agent's pre-flight check grades
   * a *different program* than conductor grades. The executed example:
   * `["bash", "-lc", "pnpm tsx goals/run-for-issue.mts"]` joined on spaces is a
   * line a shell reads as `bash -lc pnpm` with the rest positional, which runs
   * `pnpm`. The cheapest outcome is a wasted revision round.
   */
  it("renders a goal command a shell splits back into the argv conductor spawns", async () => {
    const goalCommand = ["bash", "-lc", "pnpm tsx goals/run-for-issue.mts --report 'all cases'"];
    const rendered = renderBrief({ ...base, goalCommand });

    const line = rendered
      .split("\n")
      .map((row) => row.trim())
      .find((row) => row.includes("run-for-issue.mts"));
    expect(line).toBeDefined();
    await expect(shellWords(line!)).resolves.toEqual([...goalCommand, "FIX-1"]);
  });

  it("does not hand a goal command to a dispatch that writes nothing", () => {
    const rendered = renderBrief({
      ...base,
      action: "runGoalCheck",
      goalCommand: ["pnpm", "goal"],
    });
    expect(rendered).not.toContain("pnpm goal");
  });

  it("omits the sections it has nothing for", () => {
    const bare = renderBrief({
      ...base,
      because: null,
      summary: null,
      guidancePaths: [],
    });
    expect(bare).not.toContain("Why now");
    expect(bare).not.toContain("Read before you start");
    expect(bare).not.toContain("The work item");
  });
});
