// @vitest-environment happy-dom
/**
 * What a task waits on you for is answered where you are reading: the
 * conversation. A task the teammate filed that asks you a question, or waits
 * for your review, draws a card in the conversation, at the point it asked, with
 * the whole question and a way to answer it: a reply box, which on a review
 * sends your words back as changes, beside Open review for the popup's Accept. The header carries no banner for it: the rail and the
 * task panel say it waits on you, and the card is where you act.
 *
 * The card reads the hold the board's task holds (the coding board view's
 * `asks`, the one Inbox reads) and answers through orchestration's Inbox
 * client, so an answer clears it everywhere: the rail, the task panel, and the
 * card itself, which keeps one line saying what you answered.
 *
 * The bot that waits on you sits still, with a waiting dot: nothing on it
 * hops, flashes or blinks, in any state.
 *
 * Red states produced before this was trusted: on `main` the header carries
 * "Waiting on you: …" and the conversation has no card, so every case fails at its
 * first look; answer without clearing the board's hold and the rail and panel
 * cases fail; draw the bot's alert again and the bot case fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import { scriptedServer } from "./scripted-server";
import { codingTask, hold, stubServer, TestProvider, type Posted } from "./stub-server";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const LEAD = "teammates.chief-of-staff";
const BOARD = `conversation:${LEAD}`;
const QUESTION = "Should the hire **take tasks** at once, or wait for your OK?\n\n- yes: it starts now\n- no: it waits";

/** The verdict a POST's body carries, when it carries one. */
function verdictOf(posted: Posted): Record<string, unknown> | undefined {
  const find = (value: unknown): Record<string, unknown> | undefined => {
    if (typeof value !== "object" || value === null) return undefined;
    if ("verdict" in value) return value as Record<string, unknown>;
    for (const inner of Object.values(value)) {
      const found = find(inner);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return find(posted.body);
}

/** Lead's conversation with one coding task that waits on you for `kind`; answering clears the board's hold, as the board does. */
function leadWith(kind: "question" | "review") {
  const set = (fields: Partial<CodingBoardTask>) => (server.board[BOARD]![0] = { ...server.board[BOARD]![0]!, ...fields });
  const server = stubServer({
    board: {
      [BOARD]: [
        codingTask({
          id: "t1",
          assignee: "teammates.cursor",
          harness: "cursor",
          title: "Let the lead hire a teammate",
          status: "in_progress",
          run: { sessionId: "run-1", requestId: "q1", attempt: 1 },
          asks: [hold(kind, kind === "question" ? QUESTION : "Asked: let the lead hire a teammate\n\n2 commits on teammates/t1--hire")],
        }),
      ],
    },
    answer: (posted) => {
      if (posted.path.endsWith("/actions/updateTask_tasks") || (posted.path === "/api/flows/coder/requests/q1/answer" && verdictOf(posted) !== undefined)) set({ asks: [] });
      return { ok: true };
    },
  });
  window.history.replaceState(null, "", `/?worker=${LEAD}&session=${BOARD}`);
  render(
    <TestProvider server={scriptedServer({ speed: 0.05 })} client={server.client}>
      <App />
    </TestProvider>,
  );
  return server;
}

const conversation = () => screen.getByRole("main", { name: "Conversation" });
const card = () => screen.findByRole("region", { name: "Asks you" }, { timeout: 3000 });
const railLine = () => document.querySelector<HTMLElement>(`[data-worker] [data-status]`)?.closest("[data-worker]");
const lead = () => [...document.querySelectorAll<HTMLElement>("[data-worker]")].find((entry) => entry.querySelector("[data-status]")?.textContent?.startsWith("Waiting on you"));
const panelWaits = () => [...document.querySelectorAll<HTMLElement>("aside [data-task] [data-status]")].some((chip) => /waiting on you/i.test(chip.textContent ?? ""));

describe("a task waiting on you is answered in the conversation", () => {
  it("draws the whole question as a card, with no header banner, and a reply clears it from the rail, the task panel and the card", async () => {
    const server = leadWith("question");
    const asked = await card();
    // The whole question, its Markdown drawn: never a truncated line.
    expect(asked.textContent).toContain("Should the hire take tasks at once, or wait for your OK?");
    expect(asked.textContent).not.toContain("**");
    expect(within(asked).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["yes: it starts now", "no: it waits"]);
    // The header has no banner for it; the rail and the panel still say it waits on you.
    const pill = conversation().querySelector<HTMLElement>("[data-header-status]");
    expect(pill === null || pill.hidden).toBe(true);
    await waitFor(() => expect(lead()).toBeTruthy());
    await waitFor(() => expect(panelWaits()).toBe(true));

    fireEvent.change(within(asked).getByLabelText("Your reply"), { target: { value: "Wait for my OK." } });
    await act(async () => fireEvent.click(within(asked).getByRole("button", { name: "Send reply" })));
    // The answer went to the board's hold, as Inbox sends it.
    expect(server.posts.some((p) => p.path.endsWith("/actions/updateTask_tasks") && JSON.stringify(p.body).includes("Wait for my OK."))).toBe(true);
    await waitFor(() => expect(lead()).toBeUndefined());
    await waitFor(() => expect(panelWaits()).toBe(false));
    // The card keeps one line: what you answered.
    const record = within(conversation()).getByRole("region", { name: "Asks you" });
    expect(record.textContent).toContain("You answered: Wait for my OK.");
    expect(within(record).queryByRole("textbox")).toBeNull();
    expect(railLine()).toBeTruthy();
  });

  it("sends your words back on a review as Request changes, through the run's stop", async () => {
    const server = leadWith("review");
    const asked = await card();
    expect(asked.textContent).toContain("2 commits on teammates/t1--hire");
    // Changes need words: the run must know what to change.
    expect((within(asked).getByRole("button", { name: "Request changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(asked).getByLabelText("What should change"), { target: { value: "Keep hires waiting for my OK." } });
    await act(async () => fireEvent.click(within(asked).getByRole("button", { name: "Request changes" })));
    expect(server.posts.map(verdictOf).find((v) => v !== undefined)).toEqual({ verdict: "revise", words: "Keep hires waiting for my OK." });
    await waitFor(() => expect(panelWaits()).toBe(false));
    expect(within(conversation()).getByRole("region", { name: "Asks you" }).textContent).toContain("You answered: Asked for changes: Keep hires waiting for my OK.");
  });

  // Accepting picks where the work lands, which the popup's review lays out: the card leads there.
  it("opens the task's review from Open review, where Accept is", async () => {
    leadWith("review");
    const asked = await card();
    fireEvent.click(within(asked).getByRole("button", { name: "Open review" }));
    const popup = await screen.findByRole("dialog", { name: "Coding task: Let the lead hire a teammate" }, { timeout: 3000 });
    expect(await within(popup).findByRole("button", { name: "Accept" }, { timeout: 3000 })).toBeTruthy();
  });
});

describe("a task waiting on you for more than one thing", () => {
  // Behind a hold the conversation can't answer, a later question still gets its own card and its reply lands on it.
  it("draws a card for each hold, and a reply answers the hold its card shows", async () => {
    const server = stubServer({
      board: {
        [BOARD]: [
          codingTask({
            id: "t1",
            assignee: "teammates.cursor",
            harness: "cursor",
            title: "Let the lead hire a teammate",
            status: "in_progress",
            run: { sessionId: "run-1", requestId: "q1", attempt: 1 },
            asks: [
              hold("question", "Pick a repository first.", { id: "hold-first", unanswerable: "Answer this one from the task." }),
              hold("question", "Which name should the hire get?", { id: "hold-second" }),
            ],
          }),
        ],
      },
      answer: () => ({ ok: true }),
    });
    window.history.replaceState(null, "", `/?worker=${LEAD}&session=${BOARD}`);
    render(
      <TestProvider server={scriptedServer({ speed: 0.05 })} client={server.client}>
        <App />
      </TestProvider>,
    );
    await waitFor(() => expect(within(conversation()).getAllByRole("region", { name: "Asks you" })).toHaveLength(2), { timeout: 3000 });
    const [first, second] = within(conversation()).getAllByRole("region", { name: "Asks you" });
    expect(first!.textContent).toContain("Answer this one from the task.");
    expect(within(first!).queryByRole("textbox")).toBeNull();
    expect(second!.textContent).toContain("Which name should the hire get?");
    fireEvent.change(within(second!).getByLabelText("Your reply"), { target: { value: "Call it Scout." } });
    await act(async () => fireEvent.click(within(second!).getByRole("button", { name: "Send reply" })));
    await waitFor(() => expect(second!.textContent).toContain("You answered: Call it Scout."));
    expect(server.posts.some((p) => p.path.endsWith("/actions/updateTask_tasks") && JSON.stringify(p.body).includes("Call it Scout."))).toBe(true);
  });
});

describe("the bot that waits on you", () => {
  it("sits still with a waiting dot: no hop, flash or blink in any state", async () => {
    leadWith("question");
    await card();
    const bot = conversation().querySelector<HTMLElement>("[data-bot-figure]")!;
    await waitFor(() => expect(bot.dataset.state).toBe("needs"));
    expect(bot.querySelector("[data-waiting-dot]")).toBeTruthy();
    expect(bot.querySelector(".hb-flash")).toBeNull();
    // happy-dom runs no CSS animation, so the stylesheet is where a moving bot would be: it animates nothing on the bot.
    const css = readFileSync(join(__dirname, "../src/styles.css"), "utf8");
    expect(css).not.toMatch(/\[data-bot-figure\][^{]*\{[^}]*animation/);
  });
});
