// @vitest-environment happy-dom
/**
 * The screen, on a test double (`fake-lab.ts`). These prove the UI only: a list of workers rather
 * than sessions, worker talk drawn in both conversations and the Talk panel
 * (D1), a reply that waits for your turn and shows as pending (D2), and a
 * divider that never calls a window boundary a summary, and a coding job that
 * runs as a background task, not a teammate (D4, amended by FIX-2332), in the
 * working folder, with no project anywhere (D3, amended by FIX-2335). The
 * goal check proves the package at wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { TEAMMATE_COLORS } from "../src/lib/looks";
import { createFixtureLab } from "./fake-lab";

// The script runs at a twentieth of real time.
const fast = (options = {}) => createFixtureLab({ speed: 0.05, ...options });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const workers = () => screen.getByRole("navigation", { name: "Workers" });
const conversation = () => screen.getByRole("main", { name: "Conversation" });
const talk = () => screen.getByRole("complementary", { name: "Talk" });
const teammates = () => within(workers()).getAllByRole("list")[0];
const background = () => within(workers()).getByRole("list", { name: "Background" });
const workerRow = (name: string) => workers().querySelector<HTMLElement>(`[data-worker="${name}"]`)!;
const entries = (kind: string) => [...conversation().querySelectorAll(`[data-entry="${kind}"]`)];

async function tell(worker: string, text: string) {
  const box = await screen.findByLabelText(`Message ${worker}`);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

describe("the teammates screen", () => {
  it("lists teammates, not sessions, and opens on Chief of Staff's one conversation", async () => {
    render(<App adapter={fast()} />);
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3));
    // Coding is a background task, not a teammate: the worker coding tasks run on is not listed.
    for (const coder of ["Claude Code", "Codex", "Cursor"]) expect(workers().querySelector(`[data-worker="${coder}"]`), coder).toBeNull();
    expect(workerRow("Chief of Staff").getAttribute("aria-current")).toBe("true");
    expect(within(conversation()).getByRole("heading", { name: "Chief of Staff" })).toBeTruthy();
    // Grok Bot's sidebar has no session list and no new chat.
    expect(screen.queryByRole("button", { name: /new (chat|session)/i })).toBeNull();
  });

  it("marks where Chief of Staff's word-for-word turns begin, and calls it out of view, not summarized", async () => {
    render(<App adapter={fast()} />);
    const divider = await screen.findByRole("separator");
    expect(divider.getAttribute("aria-label")).toBe("Earlier turns out of view");
    // 52 turns seeded, 50 in the window: turns 1 and 2 sit before the divider, turn 3 right after it.
    const after = divider.nextElementSibling as HTMLElement;
    expect(after.dataset.inWindow).toBe("true");
    expect(after.textContent).toMatch(/List the launch channels/);
    expect(within(conversation()).getByText(/blog first, never social first/).closest("[data-in-window]")?.getAttribute("data-in-window")).toBe("false");
  });

  it("labels the divider summarized only when the earlier turns were summarized", async () => {
    render(<App adapter={fast({ summary: true })} />);
    const divider = await screen.findByRole("separator");
    expect(divider.getAttribute("aria-label")).toBe("Earlier turns summarized");
  });

  it("draws Chief of Staff's message to researcher in both conversations and in Chief of Staff's Talk panel", async () => {
    render(<App adapter={fast()} />);
    await tell("Chief of Staff", "Ask researcher for our launch date, and help me outline the post.");

    // Step 2: one line in Chief of Staff's conversation, "Messaged researcher", that opens the exchange.
    const line = await within(conversation()).findByRole("button", { name: "Messaged researcher: What's our launch date?" });
    expect(line.getAttribute("aria-expanded")).toBeNull();
    await waitFor(() => expect(within(talk()).getByRole("region", { name: "with researcher" })).toBeTruthy());

    // While Chief of Staff waits, its row says so.
    await waitFor(() => expect(workerRow("Chief of Staff").querySelector("[data-status]")?.textContent).toBe("Messaging researcher"));

    // researcher sees the message as a line from Chief of Staff.
    fireEvent.click(workerRow("researcher"));
    expect(await within(conversation()).findByRole("region", { name: "From Chief of Staff" })).toBeTruthy();
  });

  it("opens a message line to the exchange in a popup that fills in live, and closes it with Esc or a click outside", async () => {
    render(<App adapter={fast()} />);
    await tell("Chief of Staff", "Ask researcher for our launch date, and help me outline the post.");
    const line = await within(conversation()).findByRole("button", { name: /^Messaged researcher: / });
    expect(line.querySelector("[data-sent-status]")?.textContent).toBe("working");

    // Opened from the keyboard: the line has focus when it opens.
    line.focus();
    fireEvent.click(line);
    const popup = screen.getByRole("dialog", { name: "Messaged researcher" });
    // Focus moves into the popup; the thread under it stays where it was.
    expect(popup.contains(document.activeElement)).toBe(true);
    expect(conversation().contains(line)).toBe(true);
    // Live: researcher's reading of the message, then the reply it sent, arrive while the popup is open.
    await waitFor(() => expect(popup.querySelector('[data-step="given"]')?.textContent).toMatch(/What's our launch date\?/), { timeout: 2000 });
    await waitFor(() => expect(popup.querySelector('[data-step="sent"]')?.textContent).toMatch(/Nov 12/), { timeout: 2000 });
    await waitFor(() => expect(popup.querySelector("[data-popup-status]")?.textContent).toBe("replied"));
    expect(line.querySelector("[data-sent-status]")?.textContent).toBe("replied");

    // Modal: Tab can't leave it, and focus that strayed behind it comes back in.
    const close = within(popup).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(popup.contains(document.activeElement)).toBe(true);
    line.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(popup.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(line);

    fireEvent.click(line);
    fireEvent.click(document.querySelector("[data-popup-backdrop]")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("holds researcher's reply as pending while Chief of Staff answers you, and lands it after that answer", async () => {
    render(<App adapter={fast()} />);
    await tell("Chief of Staff", "Ask researcher for our launch date, and help me outline the post.");
    await within(conversation()).findByRole("button", { name: /^Messaged researcher/ });

    // Step 3: a second line before researcher answers. Chief of Staff takes it, and the reply arrives mid-turn.
    await tell("Chief of Staff", "Make section 2 about pricing.");
    await waitFor(() => expect(conversation().querySelector("[data-pending]")?.textContent).toBe("← researcher replied · Chief of Staff reads it after this turn"), {
      interval: 5,
      timeout: 2000,
    });
    expect(within(conversation()).getByRole("status").textContent).toMatch(/Chief of Staff is answering/);
    expect(entries("received")).toHaveLength(2); // only writer's two older replies so far

    // The reply lands as its own line after Chief of Staff's answer to you, and Chief of Staff's next line uses it.
    const reply = await within(conversation()).findByRole("region", { name: "From researcher" }, { timeout: 2000 });
    expect(conversation().querySelector("[data-pending]")).toBeNull();
    const answer = within(conversation()).getByText(/Noted: "Make section 2 about pricing\."/);
    expect(answer.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(conversation()).findByText(/researcher answered: "Nov 12, per the plan doc\."/, {}, { timeout: 2000 })).toBeTruthy();
  });

  it("counts what researcher did while you watched Chief of Staff as unread, and clears it when you open researcher", async () => {
    render(<App adapter={fast()} />);
    await tell("Chief of Staff", "Ask researcher for our launch date, and help me outline the post.");
    await waitFor(() => expect(within(workerRow("researcher")).getByLabelText(/unread/).textContent).toBe("3"), { timeout: 2000 });
    fireEvent.click(workerRow("researcher"));
    await waitFor(() => expect(within(workerRow("researcher")).queryByLabelText(/unread/)).toBeNull());
  });

  it("closes the Talk panel and opens it again from the conversation", async () => {
    render(<App adapter={fast()} />);
    await screen.findByRole("region", { name: "with writer" });
    fireEvent.click(within(talk()).getByRole("button", { name: "Close talk" }));
    expect(screen.queryByRole("complementary", { name: "Talk" })).toBeNull();
    fireEvent.click(within(conversation()).getByRole("button", { name: "Talk" }));
    expect(within(talk()).getByRole("region", { name: "with writer" })).toBeTruthy();
  });

  it("starts a coding task at once, with no project anywhere on the screen, and lands its result as the coding task's", async () => {
    render(<App adapter={fast()} />);
    await tell("Chief of Staff", "Fix the typo in the README's first line.");

    // Step 5: the task runs in the working folder straight away: nothing asks where.
    const card = await within(conversation()).findByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Claude Code" });
    const tile = card.closest<HTMLElement>("[data-entry=task]")!;
    expect(tile.querySelector("[data-task-status]")?.textContent).toBe("running");
    // The lab has no projects: no select, no prompt, no card, and no word for one anywhere.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.body.textContent).not.toMatch(/project/i);

    // The result lands as the coding task's, never a teammate's, and Chief of Staff's next line uses it.
    expect(await within(conversation()).findByRole("region", { name: "From the coding task" }, { timeout: 2000 })).toBeTruthy();
    expect(within(conversation()).queryByRole("region", { name: "From Claude Code" })).toBeNull();
    expect(tile.querySelector("[data-task-status]")?.textContent).toBe("done");
    expect(await within(conversation()).findByText(/The coding task is done: "Fixed the typo in README.md, line 1\."/, {}, { timeout: 2000 })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/project/i);
  });

  it("opens a coding task's run in a popup, read only, from its line in the thread or its background item", async () => {
    render(<App adapter={fast()} />);
    await tell("Chief of Staff", "Fix the typo in the README's first line.");
    const card = await within(conversation()).findByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Claude Code" });

    // From the thread: the run fills in live, with no composer, and its result lands in it.
    fireEvent.click(card);
    let popup = await screen.findByRole("dialog", { name: "Coding task: Fix the typo in the README's first line" });
    expect(within(popup).queryByRole("textbox")).toBeNull();
    await waitFor(() => expect(popup.textContent).toMatch(/on Claude Code/), { timeout: 2000 });
    await waitFor(() => expect(popup.textContent).toMatch(/Edit \/work\/README\.md/), { timeout: 2000 });
    expect(await within(popup).findByRole("region", { name: "Result" }, { timeout: 2000 })).toBeTruthy();
    fireEvent.click(within(popup).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    // From the background list: the same popup, and the item says it's the one open. The conversation stays.
    const item = within(background()).getByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Claude Code" });
    fireEvent.click(item);
    popup = await screen.findByRole("dialog", { name: "Coding task: Fix the typo in the README's first line" });
    expect(item.getAttribute("aria-current")).toBe("true");
    expect(conversation()).toBeTruthy();
    expect(popup.textContent).toMatch(/Edit \/work\/README\.md/);
  });

  it("runs a coding task on the agent you name, and on Claude Code when you name none, and its line says which", async () => {
    // Slower than fast(): the line must be seen before the run reports its model, and fast() leaves that window under one poll.
    render(<App adapter={fast({ speed: 0.3 })} />);
    const line = () => entries("task").at(-1) as HTMLElement;
    const on = () => line().querySelector("[data-harness]")?.textContent;

    // No agent named: the default runs, with no question first. Claude Code reports no model, so none shows.
    await tell("Chief of Staff", "Fix the typo in the README's first line.");
    await waitFor(() => expect(on()).toBe("Claude Code"), { timeout: 2000 });
    await waitFor(() => expect(line().querySelector("[data-task-status]")?.textContent).toBe("done"), { timeout: 3000 });
    expect(on()).toBe("Claude Code");

    // Named: that one runs. Codex reports its model once its run starts, and only then is it shown.
    await tell("Chief of Staff", "Have Codex fix the typo in the README's first line.");
    await waitFor(() => expect(entries("task")).toHaveLength(2), { timeout: 3000 });
    await waitFor(() => expect(on()).toBe("Codex"), { timeout: 2000 });
    await waitFor(() => expect(on()).toBe("Codex · gpt-5.5-codex"), { timeout: 2000 });
    expect(line().getAttribute("aria-label")).toBe("Coding task: Fix the typo in the README's first line, on Codex · gpt-5.5-codex");
    fireEvent.click(line());
    const popup = await screen.findByRole("dialog", { name: "Coding task: Fix the typo in the README's first line" });
    expect(popup.querySelector("[data-harness]")?.textContent).toBe("Codex · gpt-5.5-codex");
    await waitFor(() => expect(popup.textContent).toMatch(/on Codex/), { timeout: 2000 });
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(line().querySelector("[data-task-status]")?.textContent).toBe("done"), { timeout: 3000 });
    await tell("Chief of Staff", "Have Cursor fix the typo in the README's first line.");
    await waitFor(() => expect(entries("task")).toHaveLength(3), { timeout: 3000 });
    await waitFor(() => expect(on()).toBe("Cursor"), { timeout: 2000 });
    // All three are tasks, never teammates.
    for (const coder of ["Claude Code", "Codex", "Cursor"]) expect(workers().querySelector(`[data-worker="${coder}"]`), coder).toBeNull();
  });

  it("shows a coding run as plain steps, the same on every harness: the result first, what it said as text, and no bare tool name", async () => {
    // Each harness reports its own tools (Claude Code's Bash and Edit, Codex's command_execution and file_change, Cursor's shell and edit).
    const BARE = /^(Bash|Read|Edit|Write|command_execution|file_change|shell|read|edit)$/;
    render(<App adapter={fast({ speed: 0.3 })} />);
    for (const [ask, harness, check] of [
      ["Fix the typo in the README's first line.", "Claude Code", "Run the docs check"],
      ["Have Codex fix the typo in the README's first line.", "Codex", "pnpm docs:check"],
      ["Have Cursor fix the typo in the README's first line.", "Cursor", "pnpm docs:check"],
    ] as const) {
      const count = entries("task").length;
      await tell("Chief of Staff", ask);
      await waitFor(() => expect(entries("task")).toHaveLength(count + 1), { timeout: 3000 });
      const line = entries("task").at(-1) as HTMLElement;
      fireEvent.click(line);
      const popup = await screen.findByRole("dialog", { name: "Coding task: Fix the typo in the README's first line" });
      // The first signal: what it starts on, before its run reports a step.
      await waitFor(() => expect(popup.textContent).toContain(`Starting on ${harness}…`), { timeout: 2000 });
      await waitFor(() => expect(line.querySelector("[data-task-status]")?.textContent).toBe("done"), { timeout: 4000 });
      await within(popup).findByRole("region", { name: "Result" }, { timeout: 2000 });

      const body = popup.querySelector("[data-step=result]")!.parentElement!;
      const kinds = [...body.children].map((el) => el.getAttribute("data-step"));
      // The result leads; under it, the harness, then what the run did in order.
      expect(kinds).toEqual(["result", "harness", "tool", "said", "tools"]);
      expect(popup.querySelector("[data-step=harness]")?.textContent).toBe(`Started on ${harness}`);
      expect(popup.querySelector("[data-step=said]")?.textContent).toContain('The typo is on line 1: "Relay keps".');
      // A run of steps folds into one line, in the same words on every harness, and opens to each one.
      const fold = popup.querySelector("[data-step=tools]")!;
      expect(fold.querySelector("summary")?.textContent).toBe("Edited a file and ran a command");
      expect([...fold.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["· Edit /work/README.md", `· ${check}`]);
      // Nothing on any line is a tool's bare name.
      const lines = [...popup.querySelectorAll("[data-step=tool], [data-step=tools] summary, [data-step=tools] li")].map((el) => el.textContent!.replace(/^· /, ""));
      for (const text of lines) expect(text, harness).not.toMatch(BARE);
      fireEvent.keyDown(document, { key: "Escape" });
    }
  }, 20_000);

  it("fails a task on a harness this machine isn't set up for at once, naming it, and runs nothing else in its place", async () => {
    render(<App adapter={fast({ notSetUp: ["cursor"] })} />);
    await tell("Chief of Staff", "Have Cursor fix the typo in the README's first line.");
    await waitFor(() => expect(entries("task")).toHaveLength(1), { timeout: 3000 });
    const line = entries("task")[0] as HTMLElement;
    await waitFor(() => expect(line.querySelector("[data-task-status]")?.textContent).toBe("failed"), { timeout: 2000 });
    expect(line.querySelector("[data-harness]")?.textContent).toBe("Cursor");
    const result = await within(conversation()).findByRole("region", { name: "From the coding task" }, { timeout: 2000 });
    expect(result.textContent).toMatch(/Cursor isn't set up on this machine/);
    // No other harness took it: one task, on Cursor, and no run.
    expect(entries("task")).toHaveLength(1);
    fireEvent.click(line);
    const popup = await screen.findByRole("dialog", { name: "Coding task: Fix the typo in the README's first line" });
    expect(popup.textContent).not.toMatch(/on Claude Code|on Codex/);
  });

  it("lines the composer up with the message list: one column token, centred, Talk open or closed", async () => {
    render(<App adapter={fast()} />);
    const box = await screen.findByLabelText("Message Chief of Staff");
    const columns = () => [...conversation().querySelectorAll<HTMLElement>("[data-column]")];
    const capped = (el: HTMLElement) => el.classList.contains("max-w-(--thread-width)") && el.classList.contains("mx-auto");
    // The list's column and the composer's: the same cap, and the composer's holds the box.
    expect(columns()).toHaveLength(2);
    expect(columns().every(capped)).toBe(true);
    expect(columns()[1].contains(box)).toBe(true);
    // Closing Talk widens the center, not the column.
    fireEvent.click(within(conversation()).getByRole("button", { name: "Talk" }));
    expect(columns().every(capped)).toBe(true);
    // The answer's text takes the column's width; only your own lines are capped, on the right.
    await waitFor(() => expect(entries("assistant").length).toBeGreaterThan(0));
    expect(entries("assistant").every((e) => !/max-w-/.test(e.className))).toBe(true);
  });

  it("stays put while you read further up: new text and a task card arrive below, and Jump to latest takes you back", async () => {
    render(<App adapter={fast()} />);
    await screen.findByLabelText("Message Chief of Staff");
    const scroller = conversation().querySelector<HTMLElement>("[data-scroller]")!;
    // happy-dom lays nothing out: give the list a size, and record every scroll it is asked for.
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 5000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 500 });
    let top = 0;
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = value) });
    const scrolls: ScrollToOptions[] = [];
    scroller.scrollTo = ((options: ScrollToOptions) => scrolls.push(options)) as typeof scroller.scrollTo;
    // Let any smooth scroll from the first render land before reading starts.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    // At the end, then up to read.
    scroller.scrollTop = 4500;
    fireEvent.scroll(scroller);
    scroller.scrollTop = 1200;
    fireEvent.scroll(scroller);
    const jump = await within(conversation()).findByRole("button", { name: "Jump to latest" });
    // Only what happens from here, while reading, counts: following before it was right.
    scrolls.length = 0;

    const before = entries("assistant");
    await tell("Chief of Staff", "Fix the typo in the README's first line.");
    // The answer streams in and a task card lands, below the reader.
    await within(conversation()).findByText(/its card shows here\./, {}, { timeout: 2000 });
    await within(conversation()).findByRole("button", { name: /Coding task/ });
    expect(conversation().querySelector("[data-scroller]")).toBe(scroller);
    expect(scrolls).toEqual([]);
    expect(scroller.scrollTop).toBe(1200);
    // What was on screen is the same nodes, not redrawn ones.
    expect(entries("assistant").slice(0, before.length)).toEqual(before);
    before.forEach((node, i) => expect(entries("assistant")[i]).toBe(node));

    fireEvent.click(jump);
    expect(scrolls.at(-1)).toEqual({ top: 5000, behavior: "smooth" });
    expect(within(conversation()).queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it("follows a streamed answer smoothly while you are at the end, and shows 'answering' only before its text starts", async () => {
    // Slow enough to look at the answer while it is still being written.
    render(<App adapter={fast({ speed: 0.5 })} />);
    await screen.findByLabelText("Message Chief of Staff");
    const scroller = conversation().querySelector<HTMLElement>("[data-scroller]")!;
    const scrolls: ScrollToOptions[] = [];
    scroller.scrollTo = ((options: ScrollToOptions) => scrolls.push(options)) as typeof scroller.scrollTo;
    await tell("Chief of Staff", "Fix the typo in the README's first line.");
    const streaming = await waitFor(
      () => {
        const last = entries("assistant").at(-1);
        // Caught part-written: it has begun, and not yet ended.
        expect(last?.textContent).toMatch(/^Starting a coding task/);
        expect(last?.textContent).not.toMatch(/its card shows here\./);
        return last!;
      },
      { interval: 5 },
    );
    // While its text is being written, the text is the sign it is answering: no second line under it.
    expect(within(conversation()).queryByRole("status")).toBeNull();
    const followed = scrolls.length;
    await within(conversation()).findByText(/its card shows here\./, {}, { timeout: 4000 });
    // It followed the text as it grew, each time smoothly, and never jumped.
    expect(scrolls.length).toBeGreaterThan(followed);
    expect(scrolls.every((s) => s.behavior === "smooth")).toBe(true);
    // The growing answer was one node all along.
    expect(entries("assistant").at(-1)).toBe(streaming);
  });

  it("draws a task card the moment it is filed and fills it in place: the same card from filing to done", async () => {
    render(<App adapter={fast()} />);
    await tell("Chief of Staff", "Fix the typo in the README's first line.");
    const card = (await within(conversation()).findByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Claude Code" })).closest("[data-entry=task]")!;
    await waitFor(() => expect(card.querySelector("[data-task-status]")?.textContent).toBe("done"), { timeout: 3000 });
    expect(conversation().querySelector("[data-entry=task]")).toBe(card);
  });

  it("sizes the composer's box to its draft in CSS, so a column that narrows rewraps and regrows it", async () => {
    render(<App adapter={fast()} />);
    const box = (await screen.findByLabelText("Message Chief of Staff")) as HTMLTextAreaElement;
    // One line to start; the browser grows the box with its text (and its width) up to the cap, then it scrolls.
    expect(box.getAttribute("rows")).toBe("1");
    expect(box.classList.contains("field-sizing-content")).toBe(true);
    expect(box.classList.contains("max-h-48")).toBe(true);
    expect(box.style.height).toBe("");
  });

  it("doesn't carry a draft to another worker: switching workers starts an empty box", async () => {
    render(<App adapter={fast()} />);
    const leadBox = (await screen.findByLabelText("Message Chief of Staff")) as HTMLTextAreaElement;
    fireEvent.change(leadBox, { target: { value: "For Chief of Staff only" } });
    fireEvent.click(workerRow("researcher"));
    const researcherBox = (await screen.findByLabelText("Message researcher")) as HTMLTextAreaElement;
    expect(researcherBox.value).toBe("");
  });

  it("doesn't send when Enter ends an input method's composition", async () => {
    render(<App adapter={fast()} />);
    const box = await screen.findByLabelText("Message Chief of Staff");
    fireEvent.change(box, { target: { value: "日本語" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    // Safari: the committing Enter arrives after compositionend, marked only by keyCode 229.
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect((box as HTMLTextAreaElement).value).toBe("日本語");
    expect(entries("user").some((e) => e.textContent?.includes("日本語"))).toBe(false);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(entries("user").some((e) => e.textContent?.includes("日本語"))).toBe(true));
  });

  it("shows what a worker waits for your yes on, and Approve answers it so its turn carries on", async () => {
    render(<App adapter={fast()} />);
    await waitFor(() => expect(workerRow("writer")).toBeTruthy());
    fireEvent.click(workerRow("writer"));
    await tell("writer", "Publish the draft.");
    const card = await within(conversation()).findByRole("region", { name: "writer asks" });
    expect(card.textContent).toContain("Publish the draft to the team page?");
    expect(card.textContent).toContain("waiting for you");
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Approve" })));
    await waitFor(() => expect(card.textContent).toContain("approved"));
    expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(await within(conversation()).findByText("Published.", {}, { timeout: 2000 })).toBeTruthy();
  });

  it("gives each teammate the icon and color its file sets, the same in the list, the header, a message line and its popup", async () => {
    render(<App adapter={fast()} />);
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3));
    const look = (row: HTMLElement) => {
      const avatar = row.querySelector<HTMLElement>("[data-avatar]")!;
      return [avatar.textContent, avatar.dataset.avatar];
    };
    expect(look(workerRow("Chief of Staff"))).toEqual(["★", "amber"]);
    expect(look(workerRow("researcher"))).toEqual(["🔎", "teal"]);
    expect(look(workerRow("writer"))).toEqual(["✎", "violet"]);
    expect(look(within(conversation()).getByRole("banner"))).toEqual(["★", "amber"]);

    await tell("Chief of Staff", "Ask researcher for our launch date, and help me outline the post.");
    const line = await within(conversation()).findByRole("button", { name: /^Messaged researcher: / });
    expect(look(line)).toEqual(["🔎", "teal"]);
    fireEvent.click(line);
    expect(look(screen.getByRole("dialog", { name: "Messaged researcher" }))).toEqual(["🔎", "teal"]);
  });

  it("gives a teammate whose file sets no look its initial, on a color of the palette", async () => {
    render(<App adapter={fast()} />);
    await screen.findByLabelText("Message Chief of Staff");
    fireEvent.click(screen.getByRole("button", { name: "Hire a teammate" }));
    const form = screen.getByRole("form", { name: "Hire a teammate" });
    fireEvent.change(within(form).getByLabelText("Teammate name"), { target: { value: "tester" } });
    fireEvent.change(within(form).getByLabelText("Teammate role"), { target: { value: "Runs the tests." } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Hire" })));
    const avatar = (await waitFor(() => workerRow("tester").querySelector<HTMLElement>("[data-avatar]")!))!;
    expect(avatar.textContent).toBe("T");
    expect(TEAMMATE_COLORS).toContain(avatar.dataset.avatar);
  });

  it("says under each name what the teammate is doing now, live, from its own state", async () => {
    render(<App adapter={fast()} />);
    const status = (name: string) => workerRow(name).querySelector("[data-status]")?.textContent;
    const header = () => conversation().querySelector("[data-header-status]")?.textContent;
    await waitFor(() => expect(status("Chief of Staff")).toMatch(/^Idle/));
    expect(header()).toMatch(/^Idle/);

    await tell("Chief of Staff", "Ask researcher for our launch date, and help me outline the post.");
    await waitFor(() => expect(status("Chief of Staff")).toBe("Replying to you"), { interval: 5 });
    expect(header()).toBe("Replying to you");
    // researcher answers the message it was sent, and says whose.
    await waitFor(() => expect(status("researcher")).toBe("Replying to Chief of Staff"), { interval: 5, timeout: 2000 });
    await waitFor(() => expect(status("Chief of Staff")).toBe("Messaging researcher"), { interval: 5, timeout: 2000 });
    // Once the reply is in and read, nothing is running: idle, and nothing made up.
    await waitFor(() => expect(status("researcher")).toMatch(/^Idle/), { timeout: 3000 });

    await tell("Chief of Staff", "Fix the typo in the README's first line.");
    await waitFor(() => expect(status("Chief of Staff")).toBe("Running coding task: Fix the typo in the README's first line"), { interval: 5, timeout: 2000 });
    expect(header()).toBe("Running coding task: Fix the typo in the README's first line");
  });

  it("hires a teammate you can talk to, changes its instructions, and fires it; the files' workers can't be", async () => {
    render(<App adapter={fast()} />);
    await screen.findByLabelText("Message Chief of Staff");
    // A worker from the files has no instructions or fire control.
    expect(within(conversation()).queryByRole("button", { name: "Fire" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hire a teammate" }));
    const form = screen.getByRole("form", { name: "Hire a teammate" });
    fireEvent.change(within(form).getByLabelText("Teammate name"), { target: { value: "Tester" } });
    fireEvent.change(within(form).getByLabelText("Teammate role"), { target: { value: "Runs the tests." } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Hire" })));
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(4));
    expect(await screen.findByLabelText("Message tester")).toBeTruthy();

    fireEvent.click(within(conversation()).getByRole("button", { name: "Instructions" }));
    const edit = screen.getByRole("form", { name: "Instructions for tester" });
    fireEvent.change(within(edit).getByLabelText("New instructions for tester"), { target: { value: "Answer in one sentence." } });
    await act(async () => fireEvent.click(within(edit).getByRole("button", { name: "Save instructions" })));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Instructions for tester" })).toBeNull());

    window.confirm = () => true;
    await act(async () => fireEvent.click(within(conversation()).getByRole("button", { name: "Fire" })));
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3));
    expect(workerRow("tester")).toBeNull();
  });
});
