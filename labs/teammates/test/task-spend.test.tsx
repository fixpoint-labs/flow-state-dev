// @vitest-environment happy-dom
/**
 * A coding task shows what its runs spent, so you can pick a harness by what
 * it costs: its line in the thread gives the tokens and, when the
 * vendor reported one, the charge; its popup gives input and output apart;
 * and the teammate's panel totals its coding tasks. A run billed by
 * subscription reports no charge and shows none, never `$0.00`. A row's stored
 * ledger reads through orchestration's fold, never summed here.
 *
 * Red states produced before this was trusted: drop the card's `Spend`, and
 * the card case fails; drop the popup's, and the popup case fails; drop the
 * panel's total, and the panel case fails; drop `spend` from `toBoardTask`,
 * and the stored-ledger case fails.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { spendAfterWrite } from "@flow-state-dev/orchestration/tasks";
import { toBoardTask } from "../src/adapter";
import { App } from "../src/App";
import { codingSpendLine } from "../src/components/TeammatePanel";
import { createFixtureLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const TASK = "Coding task: Fix the typo in the README's first line";

/** Ask Lead to have `agent` fix the typo; the task's line in the thread. */
async function fileCodingTask(agent: string) {
  const box = await screen.findByLabelText("Message Lead");
  await act(async () => {
    fireEvent.change(box, { target: { value: `Have ${agent} fix the typo in the README's first line.` } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
  const conversation = screen.getByRole("main", { name: "Conversation" });
  return within(conversation).findByRole("button", { name: new RegExp(`^${TASK}, on ${agent}`) }, { timeout: 3000 });
}

const spendOn = (el: HTMLElement) => el.querySelector("[data-spend]")?.textContent ?? null;

describe("a coding task's spend", () => {
  it("shows on its line once its run reports: tokens and the vendor's charge", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.2 })} />);
    const card = await fileCodingTask("Codex");
    expect(spendOn(card)).toBeNull();
    await waitFor(() => expect(spendOn(card)).toBe("14.7k tokens · $0.42"), { timeout: 4000 });
  });

  it("shows no dollar figure for a run billed by subscription", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.2 })} />);
    const card = await fileCodingTask("Claude Code");
    await waitFor(() => expect(spendOn(card)).toBe("9.2k tokens"), { timeout: 4000 });
  });

  it("shows in the popup with the model, input and output apart", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.2 })} />);
    const card = await fileCodingTask("Codex");
    fireEvent.click(card);
    const popup = await screen.findByRole("dialog", { name: TASK });
    await waitFor(() => expect(popup.querySelector("[data-task-spend]")?.textContent).toBe("gpt-5.5-codex · 12.4k in · 2.3k out · $0.42"), {
      timeout: 4000,
    });
  });

  it("totals in the teammate's panel across its coding tasks", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.2 })} />);
    await fileCodingTask("Codex");
    await fileCodingTask("Claude Code");
    const panel = screen.getByRole("complementary", { name: "Lead's panel" });
    await waitFor(() => expect(panel.querySelector("[data-coding-spend]")?.textContent).toBe("Coding tasks: 23.9k tokens · $0.42"), { timeout: 4000 });
  });
});

describe("a board row's spend, as the adapter reads it", () => {
  it("folds a stored ledger into the view the card draws, with the harness and model its run reported", () => {
    const run = { runId: "r1", harness: "codex", model: "gpt-5.5-codex", inputTokens: 12_400, outputTokens: 2_300, costUsd: 0.42, billing: "api-key" as const };
    const spend = spendAfterWrite({ spend: null }, { requestId: "q1", part: "settle", spend: { byModel: {}, harnessRuns: [run] } });
    const task = toBoardTask({ id: "t1", status: "completed", assignee: "teammates.codex", title: "t", spend });
    expect(task.spend).toMatchObject({ model: "gpt-5.5-codex", inputTokens: 12_400, outputTokens: 2_300, costUsd: 0.42 });
    expect(task.model).toBe("gpt-5.5-codex");
  });

  it("reads none off a row that never ran, or one whose ledger can't be read", () => {
    expect(toBoardTask({ id: "t1", status: "pending", assignee: "teammates.codex", title: "t" }).spend).toBeUndefined();
    expect(toBoardTask({ id: "t2", status: "completed", assignee: "teammates.codex", title: "t", spend: { requests: "not a list" } }).spend).toBeUndefined();
  });
});

describe("the panel's coding-task total", () => {
  const view = (inputTokens: number | null, outputTokens: number | null, costUsd: number | null, unreported = false) => ({
    harness: "codex",
    model: "gpt-5.5-codex",
    inputTokens,
    outputTokens,
    costUsd,
    unreported,
    live: false,
  });
  const task = (spend?: ReturnType<typeof view>) => toBoardTask({ id: "t", status: "completed", assignee: "teammates.codex", title: "t", ...(spend ? { spend } : {}) });

  it("says partial when a task's count is still missing a source, so a floor never reads as the whole", () => {
    expect(codingSpendLine([task(view(1_000, 200, 0.1)), task(view(2_000, null, null, true))])).toBe("Coding tasks: 3.2k tokens (partial) · $0.10");
  });

  it("is empty until some task reports a count, so a started run never reads as 0 tokens", () => {
    expect(codingSpendLine([task()])).toBe("");
    expect(codingSpendLine([task(view(null, null, null, true))])).toBe("");
  });
});
