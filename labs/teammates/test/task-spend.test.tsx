// @vitest-environment happy-dom
/**
 * A coding task shows what its runs spent, so you can pick a harness by what
 * it costs: its line in the thread gives the tokens and, when the
 * vendor reported one, the charge; its popup gives input and output apart;
 * and the teammate's panel totals its coding tasks. A run billed by
 * subscription reports no charge and shows none, never `$0.00`. A row's
 * `spend` is the coding board view's, already folded by orchestration's task
 * list; the screen never sums a ledger itself.
 *
 * Red states produced before this was trusted: drop the card's `Spend`, and
 * the card case fails; drop the popup's, and the popup case fails; drop the
 * panel's total, and the panel case fails.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import { TaskCard } from "../src/components/TaskCard";
import { codingSpendLine } from "../src/components/TeammatePanel";
import { lookOf } from "../src/lib/looks";
import { scriptedServer } from "./scripted-server";
import { codingTask, stubServer, TestProvider, POPUP_READ } from "./stub-server";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const LEAD = "teammates.chief-of-staff";
const TASK = "Coding task: Fix the typo in the README's first line";

/** What a run spent, as orchestration's fold hands it to the row: Codex on an API key reports a charge; Claude Code on a subscription, tokens only. */
const spent = (harness: string, model: string | null, inputTokens: number | null, outputTokens: number | null, costUsd: number | null, unreported = false) => ({
  harness,
  model,
  inputTokens,
  outputTokens,
  costUsd,
  unreported,
  live: false,
});
const CODEX = spent("codex", "gpt-5.5-codex", 12_400, 2_300, 0.42);
const CLAUDE = spent("claude-code", null, 8_000, 1_200, null);

/** A coding task of Lead's conversation that ran on `harness`'s worker. */
const ranOn = (id: string, harness: string, spend: CodingBoardTask["spend"]) =>
  codingTask({ id, assignee: `teammates.${harness}`, harness, title: "Fix the typo in the README's first line", status: "completed", spend });

const spendOn = (el: Element) => el.querySelector("[data-spend]")?.textContent ?? null;

describe("a coding task's spend", () => {
  it("shows on its line once its run reports: tokens and the vendor's charge", () => {
    const { container, rerender } = render(<TaskCard task={ranOn("t1", "codex", null)} coding nameOf={(id) => id} lookOf={() => lookOf({ id: "x", name: "x" })} onOpen={() => {}} />);
    expect(spendOn(container)).toBeNull();
    rerender(<TaskCard task={ranOn("t1", "codex", CODEX)} coding nameOf={(id) => id} lookOf={() => lookOf({ id: "x", name: "x" })} onOpen={() => {}} />);
    expect(spendOn(container)).toBe("14.7k tokens · $0.42");
  });

  it("shows no dollar figure for a run billed by subscription", () => {
    const { container } = render(<TaskCard task={ranOn("t1", "claude-code", CLAUDE)} coding nameOf={(id) => id} lookOf={() => lookOf({ id: "x", name: "x" })} onOpen={() => {}} />);
    expect(spendOn(container)).toBe("9.2k tokens");
  });

  it("shows in the popup with the model, input and output apart", async () => {
    window.history.replaceState(null, "", `/?worker=${LEAD}&session=conversation:${LEAD}&task=t1`);
    const server = stubServer({ board: { [`conversation:${LEAD}`]: [ranOn("t1", "codex", CODEX)] } });
    render(<TestProvider server={scriptedServer({ speed: 0.2 })} client={server.client}><App /></TestProvider>);
    const popup = await screen.findByRole("dialog", { name: TASK }, POPUP_READ);
    await waitFor(() => expect(popup.querySelector("[data-task-spend]")?.textContent).toBe("gpt-5.5-codex · 12.4k in · 2.3k out · $0.42"));
  });

  it("totals in the teammate's panel across its coding tasks", async () => {
    const server = stubServer({ board: { [`conversation:${LEAD}`]: [ranOn("t1", "codex", CODEX), ranOn("t2", "claude-code", CLAUDE)] } });
    render(<TestProvider server={scriptedServer({ speed: 0.2 })} client={server.client}><App /></TestProvider>);
    const panel = await screen.findByRole("complementary", { name: "Lead's panel" });
    await waitFor(() => expect(panel.querySelector("[data-coding-spend]")?.textContent).toBe("Coding tasks: 23.9k tokens · $0.42"));
  });
});

describe("the panel's coding-task total", () => {
  const task = (spend?: ReturnType<typeof spent>) => ranOn("t", "codex", spend ?? null);

  it("says partial when a task's count is still missing a source, so a floor never reads as the whole", () => {
    expect(codingSpendLine([task(spent("codex", "gpt-5.5-codex", 1_000, 200, 0.1)), task(spent("codex", "gpt-5.5-codex", 2_000, null, null, true))])).toBe("Coding tasks: 3.2k tokens (partial) · $0.10");
  });

  it("is empty until some task reports a count, so a started run never reads as 0 tokens", () => {
    expect(codingSpendLine([task()])).toBe("");
    expect(codingSpendLine([task(spent("codex", "gpt-5.5-codex", null, null, null, true))])).toBe("");
  });
});
