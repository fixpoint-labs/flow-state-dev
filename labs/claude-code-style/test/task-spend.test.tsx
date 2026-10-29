// @vitest-environment happy-dom
/**
 * A task card shows its run's harness, model and tokens as the board reports
 * them, and never a number nobody reported: a count no source has sent yet
 * reads "not reported", not 0.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskRow } from "../src/adapter";
import { TaskCard, TaskDoneRow } from "../src/components/TaskCard";
import { spendLine, spendSplit, spendTotal, tokens } from "../src/lib/task-spend";

afterEach(cleanup);

const spend = (patch: Partial<NonNullable<TaskRow["spend"]>> = {}): NonNullable<TaskRow["spend"]> => ({
  harness: "claude-code",
  model: "claude-sonnet",
  inputTokens: 12_000,
  outputTokens: 340,
  unreported: false,
  live: false,
  ...patch,
});
const task = (patch: Partial<TaskRow>): TaskRow => ({ id: "t1", title: "Fix the login test", goal: "g", status: "in_progress", assignee: "desk.coder", ...patch });

describe("a task's spend", () => {
  it("prints counts short", () => {
    expect([tokens(950), tokens(12_000), tokens(12_340), tokens(123_400), tokens(1_250_000)]).toEqual(["950", "12k", "12.3k", "123k", "1.3M"]);
  });

  it("puts harness, model and the total on a card's line", () => {
    expect(spendLine(spend())).toBe("claude-code · claude-sonnet · 12.3k tokens");
  });

  it("says tokens are not reported rather than showing 0", () => {
    const none = spend({ inputTokens: null, outputTokens: null, unreported: true, live: true });
    expect(spendLine(none)).toBe("claude-code · claude-sonnet · tokens not reported yet");
    expect(spendLine(none)).not.toMatch(/\b0\b/);
    expect(spendTotal(none)).toBeUndefined();
    expect(spendSplit(none)).toBe("claude-code · claude-sonnet · not reported in · not reported out · a source hasn't reported yet");
  });

  it("marks a count that is still missing a source", () => {
    expect(spendLine(spend({ unreported: true }))).toBe("claude-code · claude-sonnet · 12.3k tokens so far reported");
    expect(spendTotal(spend({ unreported: true }))).toBe("12.3k (partial)");
  });

  it("leaves out a harness or model nobody named", () => {
    expect(spendLine(spend({ harness: null, model: null }))).toBe("12.3k tokens");
  });

  it("splits input and output for the sheet", () => {
    expect(spendSplit(spend())).toBe("claude-code · claude-sonnet · 12k in · 340 out");
  });
});

describe("the cards", () => {
  it("a running card shows the spend line", () => {
    const view = render(<TaskCard task={task({ spend: spend({ live: true }) })} selected={false} onOpen={() => undefined} />).container;
    expect(view.querySelector("[data-task-spend]")?.textContent).toBe("claude-code · claude-sonnet · 12.3k tokens");
  });

  it("a finished row shows the final total", () => {
    const view = render(<TaskDoneRow task={task({ status: "completed", spend: spend() })} selected={false} onOpen={() => undefined} />).container;
    expect(view.querySelector("[data-task-spend]")?.textContent).toBe("12.3k");
  });

  it("a task that never ran shows no spend at all", () => {
    const view = render(<TaskCard task={task({ status: "pending" })} selected={false} onOpen={() => undefined} />).container;
    expect(view.querySelector("[data-task-spend]")).toBeNull();
  });
});
