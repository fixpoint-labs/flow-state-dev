// @vitest-environment happy-dom
/**
 * A harness's name on a task's card and its spend line comes from the
 * readiness view's entries, which carry each harness's label, so a harness the
 * host fills under a new id (Claude Code in plan mode, `claude-code-plan`)
 * reads as its label, never its raw id, and the lab keeps no table of names.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CodingBoardTask } from "../src/app";
import { codingBoardTask } from "./coding-board-task";
import { ThreadCard } from "../src/components/ThreadCard";
import { harnessLabelOf } from "../src/components/ThreadStatus";
import { HarnessLabels } from "../src/lib/harness-labels";
import { stubServer } from "./stub-server";

afterEach(cleanup);

const planTask = codingBoardTask({
  id: "t-1",
  title: "Plan the vendor switch",
  goal: "Plan it",
  status: "completed",
  harness: "claude-code-plan",
  assignee: "desk.thread-coder-plan",
  spend: { harness: "claude-code-plan", model: null, inputTokens: null, outputTokens: null, costUsd: null, unreported: true, live: false },
});

const LABELS = { "claude-code": "Claude Code", "claude-code-plan": "Claude Code (plan)" };

describe("a plan task's harness name", () => {
  it("reads as the readiness view's label on its card, not the harness id", () => {
    render(
      stubServer().wrap(
        <HarnessLabels.Provider value={LABELS}>
          <ThreadCard sessionId="s-1" task={planTask} onOpen={() => {}} />
        </HarnessLabels.Provider>,
      ),
    );
    expect(screen.getByText("Claude Code (plan)")).toBeTruthy();
    expect(screen.queryByText("claude-code-plan")).toBeNull();
  });

  it("reads as the label on its spend line", () => {
    expect(harnessLabelOf(planTask, LABELS)).toBe("Claude Code (plan)");
  });
});

describe("a coding run nobody reviewed by its deadline", () => {
  it("is marked Not reviewed on its card, so it never reads as approved, and an accepted one is not", () => {
    const done: CodingBoardTask = { ...planTask, harness: "claude-code", assignee: "desk.thread-coder" };
    render(stubServer().wrap(<ThreadCard sessionId="s-1" task={{ ...done, review: "deadline" }} onOpen={() => {}} />));
    expect(screen.getByText("Not reviewed")).toBeTruthy();
    cleanup();
    render(stubServer().wrap(<ThreadCard sessionId="s-1" task={{ ...done, review: "accepted" }} onOpen={() => {}} />));
    expect(screen.queryByText("Not reviewed")).toBeNull();
  });
});
