// @vitest-environment happy-dom
/**
 * The screen, on the scripted server (`scripted-server.ts`). These prove the UI only: a list of workers rather
 * than sessions, worker talk drawn in both conversations (D1), the open
 * teammate's panel with the tasks its conversation filed, a reply that waits for your turn and shows as pending (D2), and a
 * divider that never calls a window boundary a summary, and a coding job that
 * runs as a background task, not a teammate (D4, amended by FIX-2332), in the
 * working folder, with no project anywhere (D3, amended by FIX-2335). The
 * goal check proves the package at wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { App } from "../src/components/App";
import { codingTask, POPUP_READ, stubServer, TestProvider, type StubData } from "./stub-server";
import { TEAMMATE_COLORS } from "../src/lib/looks";
import { scriptedServer } from "./scripted-server";

// The script runs at a twentieth of real time.
const fast = (options = {}) => scriptedServer({ speed: 0.05, ...options });

/** Lead's conversation, as the scripted server names it: the board its tasks are filed on. */
const LEAD = "conversation:teammates.chief-of-staff";

/**
 * The lab on the scripted server, with each conversation's tasks served by a stand-in coding board (and
 * whatever else `data` names: a run's items, its recorded plan): the scripted server files no tasks.
 */
function renderOnBoard(board: Record<string, CodingBoardTask[]>, data: Omit<StubData, "board"> = {}, options = {}) {
  const server = stubServer({ board, ...data });
  const lab = fast(options);
  render(<TestProvider server={lab} client={server.client}><App /></TestProvider>);
  return { lab, server };
}

/** A coding task on `harness`'s worker, filed from Lead's conversation. */
const coding = (id: string, harness: "cursor" | "codex" | "claude-code", fields: Partial<CodingBoardTask> = {}) =>
  codingTask({ id, assignee: `teammates.${harness}`, title: "Fix the typo in the README's first line", harness, status: "in_progress", ...fields });

/** A coding run's items in its session, in `harness`'s own shapes: it reads the file, says where the typo is, edits it, and runs the docs check. */
const runItems = (harness: "cursor" | "codex" | "claude-code", requestId: string) => {
  const tools = {
    "claude-code": [["Read", { file_path: "/work/README.md" }], ["Edit", { file_path: "/work/README.md", old_string: "Relay keps", new_string: "Relay keeps" }], ["Bash", { command: "pnpm docs:check", description: "Run the docs check" }]],
    codex: [["command_execution", { command: "sed -n 1p README.md" }], ["file_change", { changes: [{ path: "/work/README.md", kind: "update" }] }], ["command_execution", { command: "cd /work && pnpm docs:check" }]],
    cursor: [["read", { path: "/work/README.md" }], ["edit", { path: "/work/README.md" }], ["shell", { command: "pnpm docs:check" }]],
  }[harness] as [string, Record<string, unknown>][];
  const item = (n: number, body: Record<string, unknown>) => ({ id: `${requestId}-${n}`, requestId, status: "completed", provenance: { blockName: `${harness}-agent` }, ...body });
  const tool = (n: number, [name, args]: [string, Record<string, unknown>]) => item(n, { type: "tool_output", toolCall: { name, arguments: JSON.stringify(args) } });
  return [
    tool(1, tools[0]!),
    item(2, { type: "message", role: "assistant", content: [{ type: "output_text", text: 'The typo is on line 1: "Relay keps".' }] }),
    tool(3, tools[1]!),
    tool(4, tools[2]!),
  ];
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  // The app keeps what is open in the page's address; each test starts on a bare one.
  window.history.replaceState(null, "", "/");
});

const workers = () => screen.getByRole("navigation", { name: "Workers" });
const conversation = () => screen.getByRole("main", { name: "Conversation" });
/** A status line of the conversation itself: the composer's attachment notices are a status region too. */
const OUTSIDE_COMPOSER = { name: (_name: string, element: Element) => element.closest("form") === null };
const panel = (name: string) => screen.getByRole("complementary", { name: `${name}'s panel` });
const teammates = () => within(workers()).getAllByRole("list")[0];
const workerRow = (name: string) => workers().querySelector<HTMLElement>(`[data-worker="${name}"]`)!;
const entries = (kind: string) => [...conversation().querySelectorAll(`[data-entry="${kind}"], [data-line="${kind}"]`)];

async function tell(worker: string, text: string) {
  const box = await screen.findByLabelText(`Message ${worker}`);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}


/**
 * Lay the scrolling feeds out as a browser would (happy-dom lays nothing out): the conversation's
 * list and a popup's body, each 5000px of content in a 500px view, or
 * `height(feed)` px for a test whose content must grow. Every scroll they are asked
 * for is recorded with how it moves, and lands at once. Undone by the returned function.
 */
function layOutFeeds(height: (feed: HTMLElement) => number = () => 5000) {
  const isFeed = (el: HTMLElement) =>
    el.matches("[data-scroller]") || (el.parentElement?.getAttribute("role") === "dialog" && el.classList.contains("overflow-y-auto"));
  const names = ["scrollHeight", "clientHeight", "scrollTop", "scrollTo"] as const;
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name) ?? Object.getOwnPropertyDescriptor(Element.prototype, name)] as const);
  const tops = new WeakMap<HTMLElement, number>();
  const scrolls: { feed: HTMLElement; behavior: ScrollBehavior | undefined }[] = [];
  Object.defineProperties(HTMLElement.prototype, {
    scrollHeight: { configurable: true, get(this: HTMLElement) { return isFeed(this) ? height(this) : 0; } },
    clientHeight: { configurable: true, get(this: HTMLElement) { return isFeed(this) ? 500 : 0; } },
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) { return tops.get(this) ?? 0; },
      set(this: HTMLElement, value: number) { tops.set(this, isFeed(this) ? Math.max(0, Math.min(value, height(this) - 500)) : 0); },
    },
    scrollTo: {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        if (isFeed(this)) scrolls.push({ feed: this, behavior: options.behavior });
        this.scrollTop = options.top ?? 0;
      },
    },
  });
  const restore = () => {
    for (const [name, was] of saved) {
      if (was === undefined) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      else Object.defineProperty(HTMLElement.prototype, name, was);
    }
  };
  return { scrolls, restore };
}

describe("the teammates screen", () => {
  it("lists teammates, not sessions, and opens on Lead's one conversation", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3));
    // Coding is a background task, not a teammate: the worker coding tasks run on is not listed.
    for (const coder of ["Claude Code", "Codex", "Cursor"]) expect(workers().querySelector(`[data-worker="${coder}"]`), coder).toBeNull();
    expect(workerRow("Lead").getAttribute("aria-current")).toBe("true");
    expect(within(conversation()).getByRole("heading", { name: "Lead" })).toBeTruthy();
    // Grok Bot's sidebar has no session list and no new chat.
    expect(screen.queryByRole("button", { name: /new (chat|session)/i })).toBeNull();
  });

  it("marks where Lead's word-for-word turns begin, and calls it out of view, not summarized", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    const divider = await screen.findByRole("separator");
    expect(divider.getAttribute("aria-label")).toBe("Earlier turns out of view");
    // 52 turns seeded, 50 in the window: turns 1 and 2 sit before the divider, turn 3 right after it.
    const after = divider.nextElementSibling as HTMLElement;
    expect(after.dataset.inWindow).toBe("true");
    expect(after.textContent).toMatch(/List the launch channels/);
    expect(within(conversation()).getByText(/blog first, never social first/).closest("[data-in-window]")?.getAttribute("data-in-window")).toBe("false");
  });

  it("labels the divider summarized only when the earlier turns were summarized", async () => {
    render(<TestProvider server={fast({ summary: true })}><App /></TestProvider>);
    const divider = await screen.findByRole("separator");
    expect(divider.getAttribute("aria-label")).toBe("Earlier turns summarized");
  });

  it("draws Lead's message to researcher in both conversations", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");

    // Step 2: one line in Lead's conversation, "Messaged researcher", that opens the exchange.
    const line = await within(conversation()).findByRole("button", { name: "Messaged researcher: What's our launch date?" });
    expect(line.getAttribute("aria-expanded")).toBeNull();

    // While Lead waits, its row says so.
    await waitFor(() => expect(workerRow("Lead").querySelector("[data-status]")?.textContent).toBe("Messaging researcher"));

    // researcher sees the message as a line from Lead.
    fireEvent.click(workerRow("researcher"));
    expect(await within(conversation()).findByRole("region", { name: "From Lead" })).toBeTruthy();
  });

  it("opens a message line to the exchange in a popup that fills in live, and closes it with Esc or a click outside", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
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
    await waitFor(() => expect(popup.querySelector('[data-line="received"]')?.textContent).toMatch(/What's our launch date\?/), { timeout: 2000 });
    await waitFor(() => expect(popup.querySelector('[data-line="sent"]')?.textContent).toMatch(/Nov 12/), { timeout: 2000 });
    await waitFor(() => expect(popup.querySelector("[data-overlay-status]")?.textContent).toBe("replied"));
    expect(line.querySelector("[data-sent-status]")?.textContent).toBe("replied");

    // Modal: Tab can't leave it, and focus that strayed behind it comes back in.
    const close = within(popup).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(popup.contains(document.activeElement)).toBe(true);
    line.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(popup.contains(document.activeElement)).toBe(true);

    // An input method's Esc ends its composition, not the popup.
    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // The Esc that closes is spent, so nothing under the popup acts on it too.
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(line);

    // Its close button and a click outside close it the same way, and focus goes back to the line.
    line.focus();
    fireEvent.click(line);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(line);

    line.focus();
    fireEvent.click(line);
    fireEvent.click(document.querySelector("[data-overlay-backdrop]")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(line);
  });

  it("a pick from ⌘K over a popup closes the popup, so the picked conversation takes the keys", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
    const line = await within(conversation()).findByRole("button", { name: /^Messaged researcher: / });
    line.focus();
    fireEvent.click(line);
    screen.getByRole("dialog", { name: "Messaged researcher" });
    act(() => void fireEvent.keyDown(document.activeElement!, { key: "k", metaKey: true }));
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "drafts and tightens" } });
    act(() => void fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Message writer")));
  });

  it("an Esc in ⌘K over a popup closes the switcher only, and the popup stays open under it", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
    const line = await within(conversation()).findByRole("button", { name: /^Messaged researcher: / });
    line.focus();
    fireEvent.click(line);
    screen.getByRole("dialog", { name: "Messaged researcher" });
    act(() => void fireEvent.keyDown(document.activeElement!, { key: "k", metaKey: true }));
    const input = await screen.findByRole("combobox");
    act(() => void fireEvent.keyDown(input, { key: "Escape" }));
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(screen.getByRole("dialog", { name: "Messaged researcher" })).toBeTruthy();
  });

  it("holds researcher's reply as pending while Lead answers you, and lands it after that answer", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
    await within(conversation()).findByRole("button", { name: /^Messaged researcher/ });

    // Step 3: a second line before researcher answers. Lead takes it, and the reply arrives mid-turn.
    await tell("Lead", "Make section 2 about pricing.");
    await waitFor(() => expect(conversation().querySelector("[data-pending]")?.textContent).toBe("← researcher replied · Lead reads it after this turn"), {
      interval: 5,
      timeout: 2000,
    });
    expect(within(conversation()).getByRole("status", OUTSIDE_COMPOSER).textContent).toMatch(/Lead is answering/);
    expect(entries("received")).toHaveLength(2); // only writer's two older replies so far

    // The reply lands as its own line after Lead's answer to you, and Lead's next line uses it.
    const reply = await within(conversation()).findByRole("region", { name: "From researcher" }, { timeout: 2000 });
    expect(conversation().querySelector("[data-pending]")).toBeNull();
    const answer = within(conversation()).getByText(/Noted: "Make section 2 about pricing\."/);
    expect(answer.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(conversation()).findByText(/researcher answered: "Nov 12, per the plan doc\."/, {}, { timeout: 2000 })).toBeTruthy();
  });

  it("answers a line you send while Lead answers at once, beside that answer, and never says it waits", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await tell("Lead", "Meanwhile, draft the release note.");
    await within(conversation()).findByRole("status", OUTSIDE_COMPOSER);
    // The composer says what a line sent now does.
    expect(screen.getByText(/Lead is answering · a line you send now gets its own answer at once/)).toBeTruthy();
    await tell("Lead", "Ask researcher for our launch date.");
    // Its answer lands while the first turn still runs: that one's text hasn't.
    await within(conversation()).findByText(/Asking researcher now/, {}, { timeout: 2000 });
    expect(within(conversation()).queryByText("Drafted.")).toBeNull();
    expect(screen.getByText(/Lead is answering · a line you send now gets its own answer at once/)).toBeTruthy();
    expect(screen.queryByText(/waits for/)).toBeNull();
  });

  it("counts what researcher did while you watched Lead as unread, and clears it when you open researcher", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
    await waitFor(() => expect(within(workerRow("researcher")).getByLabelText(/unread/).textContent).toBe("3"), { timeout: 2000 });
    fireEvent.click(workerRow("researcher"));
    await waitFor(() => expect(within(workerRow("researcher")).queryByLabelText(/unread/)).toBeNull());
  });

  it("has no Talk panel or Talk control: the right pane is the open teammate's panel", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await screen.findByLabelText("Message Lead");
    expect(screen.queryByRole("complementary", { name: "Talk" })).toBeNull();
    expect(screen.queryByRole("button", { name: /talk/i })).toBeNull();
    // Who it is, at the top of its panel, and a place for its routines.
    const info = within(panel("Lead")).getByRole("region", { name: "Teammate" });
    expect(within(info).getByRole("heading", { name: "Lead" })).toBeTruthy();
    expect(info.textContent).toMatch(/Plans the launch with you/);
    expect(within(panel("Lead")).getByRole("region", { name: "Routines" })).toBeTruthy();
  });

  it("lists only the open teammate's tasks in its panel, and switching teammates switches them", async () => {
    // Each teammate's conversation filed its own: a list that leaked another's would show both titles.
    renderOnBoard({
      [LEAD]: [coding("t-lead", "cursor", { title: "Bump the version" })],
      "conversation:teammates.researcher": [codingTask({ id: "t-research", assignee: "teammates.writer", title: "Draft the survey summary", status: "in_progress" })],
    });
    const lead = await screen.findByRole("button", { name: "Coding task: Bump the version, on Cursor" }, POPUP_READ);
    expect(panel("Lead").contains(lead)).toBe(true);
    expect(screen.queryByRole("button", { name: "Asked writer to draft the survey summary" })).toBeNull();

    fireEvent.click(workerRow("researcher"));
    const research = await within(panel("researcher")).findByRole("button", { name: "Asked writer to draft the survey summary" });
    expect(screen.queryByRole("complementary", { name: "Lead's panel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Coding task: Bump the version, on Cursor" })).toBeNull();
    // A row opens the task's popup, the same one its line in the thread opens.
    fireEvent.click(research);
    expect(await screen.findByRole("dialog", { name: "Asked writer to draft the survey summary" })).toBeTruthy();
    expect(research.getAttribute("aria-current")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(workerRow("writer"));
    expect(await within(panel("writer")).findByText("writer hasn't started any tasks yet.")).toBeTruthy();
  });

  it("puts the running tasks first, shows the failed ones, folds done and cancelled into groups with their counts, and moves a task that ends into its group live", async () => {
    const ended = (id: string, title: string, status: "completed" | "errored" | "cancelled") => codingTask({ id, assignee: "teammates.researcher", title, status });
    const { server } = renderOnBoard({
      [LEAD]: [ended("t-1", "Look up the launch date", "completed"), ended("t-2", "Check the beta numbers", "errored"), ended("t-3", "Find a customer quote", "completed"), ended("t-4", "Pull the survey", "cancelled")],
    });
    const side = await screen.findByRole("complementary", { name: "Lead's panel" });
    const groups = () => [...side.querySelectorAll("button[aria-expanded]")].map((b) => b.getAttribute("aria-label"));
    // Done and cancelled tasks are folded: their groups show counts, and none of their rows.
    await waitFor(() => expect(groups()).toEqual(["Done (2)", "Cancelled (1)"]));
    const folded = () => [...side.querySelectorAll("button[aria-expanded]")].map((b) => b.getAttribute("aria-expanded"));
    expect(folded()).toEqual(["false", "false"]);
    expect(within(side).queryByRole("button", { name: "Asked researcher to look up the launch date" })).toBeNull();
    // A failure is something to act on: its rows show without a click.
    const failed = within(side).getByRole("list", { name: "Failed" });
    expect(within(failed).getByRole("button", { name: "Asked researcher to check the beta numbers" })).toBeTruthy();
    // Opening a group shows its rows, and only its own.
    fireEvent.click(within(side).getByRole("button", { name: /^Done \(2\)/ }));
    expect(folded()).toEqual(["true", "false"]);
    const done = within(side).getByRole("list", { name: "Done" });
    expect(within(done).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Asked researcher to look up the launch date", "Asked researcher to find a customer quote"]);
    expect(within(done).queryByRole("button", { name: "Asked researcher to check the beta numbers" })).toBeNull();

    // A task filed now runs at the top, above the groups, and moves into Done when it ends, with no reload.
    const board = server.board[LEAD]!;
    board.push(coding("t-5", "cursor"));
    const active = await within(side).findByRole("list", { name: "Running" }, { timeout: 2000 });
    expect(within(active).getByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Cursor" })).toBeTruthy();
    expect(active.compareDocumentPosition(within(side).getByRole("button", { name: /^Done/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    board[4] = { ...board[4]!, status: "completed", completedAt: Date.now() };
    await waitFor(() => expect(within(side).getByRole("button", { name: /^Done \(3\)/ })).toBeTruthy(), { timeout: 4000 });
    expect(within(side).queryByRole("list", { name: "Running" })).toBeNull();
    expect(within(within(side).getByRole("list", { name: "Done" })).getByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Cursor" })).toBeTruthy();
  });

  it("draws a coding task from its board row with no project anywhere on the screen, and its word follows the row", async () => {
    const { server } = renderOnBoard({ [LEAD]: [coding("t-1", "cursor")] });
    const side = await screen.findByRole("complementary", { name: "Lead's panel" });
    const row = await within(side).findByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Cursor" }, POPUP_READ);
    expect(row.getAttribute("data-task")).toBe("running");
    // The lab has no projects: no select, no prompt, no card, and no word for one anywhere.
    expect(screen.queryByRole("combobox")).toBeNull();
    // The one group on screen is the harness chips (FIX-2403), never a project choice.
    expect(screen.queryAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Coding harnesses"]);
    expect(document.body.textContent).not.toMatch(/project/i);

    server.board[LEAD]![0] = { ...server.board[LEAD]![0]!, status: "completed", completedAt: Date.now() };
    fireEvent.click(await within(side).findByRole("button", { name: /^Done \(1\)/ }, { timeout: 2000 }));
    expect(within(side).getByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Cursor" }).getAttribute("data-task")).toBe("done");
    expect(document.body.textContent).not.toMatch(/project/i);
  });

  it("shows a finished task's answer in its popup, read for that one task on the popup's own board read, and on no other read", async () => {
    const { server } = renderOnBoard({
      [LEAD]: [coding("t-1", "cursor", { status: "completed", completedAt: Date.now(), detail: { answer: "Fixed the typo in README.md, line 1.", answerCut: false } })],
    });
    const side = await screen.findByRole("complementary", { name: "Lead's panel" });
    fireEvent.click(await within(side).findByRole("button", { name: /^Done \(1\)/ }, POPUP_READ));
    fireEvent.click(within(side).getByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Cursor" }));
    const popup = await screen.findByRole("dialog", { name: "Coding task: Fix the typo in the README's first line" }, POPUP_READ);
    await waitFor(() => expect(within(popup).getByRole("region", { name: "Result" }).textContent).toBe("Fixed the typo in README.md, line 1."));
    // The answer came on a read naming the task; every other board read named none, so none carried it.
    expect(server.boardReads.filter((read) => read.taskId !== undefined).every((read) => read.taskId === "t-1" && read.sessionId === LEAD)).toBe(true);
    expect(server.boardReads.some((read) => read.taskId === "t-1")).toBe(true);
    expect(server.boardReads.some((read) => read.taskId === undefined)).toBe(true);
  });

  it("opens a coding task's run in a popup from its row in the teammate's panel, filled from its run session, with no composer, and its result lands there", async () => {
    const run = { sessionId: "run-1", requestId: "q1", attempt: 1 };
    const { server } = renderOnBoard({ [LEAD]: [coding("t-1", "claude-code", { run, runFlow: "coder" })] }, { items: { "run-1": runItems("claude-code", "q1") } });
    const side = await screen.findByRole("complementary", { name: "Lead's panel" });
    const item = await within(side).findByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Claude Code" }, POPUP_READ);
    fireEvent.click(item);
    const popup = await screen.findByRole("dialog", { name: "Coding task: Fix the typo in the README's first line" }, POPUP_READ);
    // Its one box is the task's Steer line: the run takes no messages.
    expect(within(popup).getAllByRole("textbox").map((box) => box.getAttribute("aria-label"))).toEqual(["Steer this task"]);
    await waitFor(() => expect(popup.textContent).toMatch(/Edit \/work\/README\.md/), { timeout: 2000 });
    // It ends: its answer lands in the popup open on it.
    server.board[LEAD]![0] = { ...server.board[LEAD]![0]!, status: "completed", completedAt: Date.now(), detail: { answer: "Fixed the typo in README.md, line 1.", answerCut: false } };
    expect((await within(popup).findByRole("region", { name: "Result" }, { timeout: 2000 })).textContent).toBe("Fixed the typo in README.md, line 1.");
    // The row says it's the one open, and the conversation stays.
    expect(item.getAttribute("aria-current")).toBe("true");
    expect(conversation()).toBeTruthy();
  });

  it("says on a coding task's line which harness it runs on, and its model only once its run reported one", async () => {
    const { server } = renderOnBoard({ [LEAD]: [coding("t-1", "cursor"), coding("t-2", "codex", { title: "Bump the version" })] });
    const side = await screen.findByRole("complementary", { name: "Lead's panel" });
    // Cursor reports no model, so none shows.
    expect(await within(side).findByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Cursor" }, POPUP_READ)).toBeTruthy();
    expect(within(side).getByRole("button", { name: "Coding task: Bump the version, on Codex" })).toBeTruthy();
    // Codex reports its model once its run starts, and only then is it shown.
    const spend = { harness: "codex", model: "gpt-5.5-codex", inputTokens: null, outputTokens: null, costUsd: null, unreported: false, live: true };
    server.board[LEAD]![1] = { ...server.board[LEAD]![1]!, spend } as CodingBoardTask;
    const codex = await within(side).findByRole("button", { name: "Coding task: Bump the version, on Codex · gpt-5.5-codex" }, { timeout: 2000 });
    fireEvent.click(codex);
    const popup = await screen.findByRole("dialog", { name: "Coding task: Bump the version" }, POPUP_READ);
    expect(popup.querySelector("[data-harness]")?.textContent).toBe("Codex · gpt-5.5-codex");
    // Coding workers are tasks' workers, never teammates.
    for (const coder of ["Claude Code", "Codex", "Cursor"]) expect(workers().querySelector(`[data-worker="${coder}"]`), coder).toBeNull();
  });

  it("shows a coding run as plain steps, the same on every harness: what it said as text, the result last, and no bare tool name", async () => {
    // Each harness reports its own tools (Claude Code's Bash and Edit, Codex's command_execution and file_change, Cursor's shell and edit).
    const BARE = /^(Bash|Read|Edit|Write|command_execution|file_change|shell|read|edit)$/;
    const HARNESSES = [
      ["claude-code", "Claude Code", "Run the docs check"],
      ["codex", "Codex", "pnpm docs:check"],
      ["cursor", "Cursor", "pnpm docs:check"],
    ] as const;
    const ran = (harness: (typeof HARNESSES)[number][0]) =>
      coding(`t-${harness}`, harness, { title: `Fix the typo on ${harness}`, status: "completed", completedAt: Date.now(), run: { sessionId: `run-${harness}`, requestId: `q-${harness}`, attempt: 1 }, runFlow: "coder", detail: { answer: "Fixed the typo in README.md, line 1.", answerCut: false } });
    renderOnBoard(
      { [LEAD]: [...HARNESSES.map(([harness]) => ran(harness)), coding("t-new", "codex", { title: "Not reported yet", run: { sessionId: "run-new", requestId: "q-new", attempt: 1 }, runFlow: "coder" })] },
      { items: Object.fromEntries(HARNESSES.map(([harness]) => [`run-${harness}`, runItems(harness, `q-${harness}`)])) },
    );
    const side = await screen.findByRole("complementary", { name: "Lead's panel" });
    // The first signal: what it starts on, before its run reports a step.
    fireEvent.click(await within(side).findByRole("button", { name: "Coding task: Not reported yet, on Codex" }, POPUP_READ));
    const starting = await screen.findByRole("dialog", { name: "Coding task: Not reported yet" }, POPUP_READ);
    await waitFor(() => expect(starting.textContent).toContain("Starting on Codex…"), { timeout: 2000 });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(side).getByRole("button", { name: /^Done \(3\)/ }));
    for (const [harness, name, check] of HARNESSES) {
      fireEvent.click(within(side).getByRole("button", { name: `Coding task: Fix the typo on ${harness}, on ${name}` }));
      const popup = await screen.findByRole("dialog", { name: `Coding task: Fix the typo on ${harness}` });
      await waitFor(() => expect(popup.querySelector("[data-step=tools]")).not.toBeNull(), { timeout: 2000 });
      await within(popup).findByRole("region", { name: "Result" }, { timeout: 2000 });

      const body = popup.querySelector("[data-step=result]")!.parentElement!;
      const kinds = [...body.querySelectorAll(":scope > [data-step], :scope > [data-entry]")].map((el) => el.getAttribute("data-step") ?? el.getAttribute("data-entry"));
      // The harness, then what the run did in order, then its result last: the popup opens on its latest entry.
      expect(kinds).toEqual(["harness", "tool", "assistant", "tools", "result"]);
      expect(popup.querySelector("[data-step=harness]")?.textContent).toBe(`Started on ${name}`);
      expect(popup.querySelector("[data-entry=assistant]")?.textContent).toContain('The typo is on line 1: "Relay keps".');
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

  it("draws a task that failed before any run as failed, with its reason, and names no harness it ran on", async () => {
    const reason = "Cursor isn't set up on this machine: no sign-in found. Sign in to Cursor, then start the task again.";
    renderOnBoard({ [LEAD]: [coding("t-1", "cursor", { status: "errored", completedAt: Date.now(), error: reason })] });
    const side = await screen.findByRole("complementary", { name: "Lead's panel" });
    const line = await within(await within(side).findByRole("list", { name: "Failed" }, POPUP_READ)).findByRole("button", { name: "Coding task: Fix the typo in the README's first line, on Cursor" });
    expect(line.getAttribute("data-task")).toBe("failed");
    expect(line.textContent).toMatch(/Cursor isn't set up on this machine/);
    fireEvent.click(line);
    const popup = await screen.findByRole("dialog", { name: "Coding task: Fix the typo in the README's first line" }, POPUP_READ);
    expect(within(popup).getByRole("alert").textContent).toMatch(/Cursor isn't set up on this machine/);
    // Its run started nowhere: the popup names no harness it ran on.
    expect(popup.textContent).not.toMatch(/(Started|Starting) on (Claude Code|Codex)/);
  });

  it("lines the composer up with the message list: one column token, centred", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    const box = await screen.findByLabelText("Message Lead");
    const columns = () => [...conversation().querySelectorAll<HTMLElement>("[data-column]")];
    const capped = (el: HTMLElement) => el.classList.contains("max-w-(--thread-width)") && el.classList.contains("mx-auto");
    // The list's column and the composer's: the same cap, and the composer's holds the box.
    expect(columns()).toHaveLength(2);
    expect(columns().every(capped)).toBe(true);
    expect(columns()[1].contains(box)).toBe(true);
    // The answer's text takes the column's width; only your own lines are capped, on the right.
    await waitFor(() => expect(entries("assistant").length).toBeGreaterThan(0));
    expect(entries("assistant").every((e) => !/max-w-/.test(e.className))).toBe(true);
  });

  it("stays put while you read further up: new text arrives below, and Jump to latest takes you back", async () => {
    // Slow enough to scroll up while the answer is still being written.
    const feeds = layOutFeeds();
    onTestFinished(feeds.restore);
    render(<TestProvider server={fast({ speed: 0.5 })}><App /></TestProvider>);
    await screen.findByLabelText("Message Lead");
    const scroller = conversation().querySelector<HTMLElement>("[data-scroller]")!;
    const before = entries("assistant");
    await tell("Lead", "Walk me through the launch post.");
    await waitFor(() => expect(entries("assistant").at(-1)?.textContent).toMatch(/^Here is the plan/), { interval: 5 });
    // Up to read while it is still being written.
    scroller.scrollTop = 1200;
    fireEvent.scroll(scroller);
    const jump = await within(conversation()).findByRole("button", { name: "Jump to latest" });
    feeds.scrolls.length = 0;

    // The rest of the answer streams in, below the reader.
    await within(conversation()).findByText(/That is the whole plan\./, {}, { timeout: 4000 });
    expect(conversation().querySelector("[data-scroller]")).toBe(scroller);
    expect(feeds.scrolls).toEqual([]);
    expect(scroller.scrollTop).toBe(1200);
    // What was on screen is the same nodes, not redrawn ones.
    expect(entries("assistant").slice(0, before.length)).toEqual(before);
    before.forEach((node, i) => expect(entries("assistant")[i]).toBe(node));

    fireEvent.click(jump);
    expect(feeds.scrolls.at(-1)).toEqual({ feed: scroller, behavior: "smooth" });
    expect(scroller.scrollTop).toBe(4500);
    expect(within(conversation()).queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it("opens a worker's conversation already at its end, with no scroll to watch, and switching workers does the same", async () => {
    const feeds = layOutFeeds();
    try {
      render(<TestProvider server={fast()}><App /></TestProvider>);
      await screen.findByLabelText("Message Lead");
      await screen.findByRole("separator");
      const first = conversation().querySelector<HTMLElement>("[data-scroller]")!;
      expect(first.scrollTop).toBe(4500);
      // Up to read, then over to another worker: it opens on its own latest turn, not where you were.
      first.scrollTop = 1200;
      fireEvent.scroll(first);
      fireEvent.click(workerRow("researcher"));
      await screen.findByLabelText("Message researcher");
      const second = conversation().querySelector<HTMLElement>("[data-scroller]")!;
      expect(second.scrollTop).toBe(4500);
      // Opening is never an animation: every move to the end so far was instant.
      expect(feeds.scrolls.length).toBeGreaterThan(0);
      expect(feeds.scrolls.filter((s) => s.behavior !== "instant")).toEqual([]);
    } finally {
      feeds.restore();
    }
  });

  it("opens a message's popup already at its latest step, and leaves it there as the reply arrives", async () => {
    const feeds = layOutFeeds();
    try {
      render(<TestProvider server={fast()}><App /></TestProvider>);
      await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
      const line = await within(conversation()).findByRole("button", { name: /^Messaged researcher: / });
      feeds.scrolls.length = 0;
      fireEvent.click(line);
      const popup = screen.getByRole("dialog", { name: "Messaged researcher" });
      const body = popup.querySelector<HTMLElement>(".overflow-y-auto")!;
      expect(body.scrollTop).toBe(4500);
      const opening = feeds.scrolls.filter((s) => s.feed === body);
      expect(opening.length).toBeGreaterThan(0);
      expect(opening.every((s) => s.behavior === "instant")).toBe(true);
      // The reply lands after it opened, and moves nothing.
      await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const opened = feeds.scrolls.filter((s) => s.feed === body).length;
      await waitFor(() => expect(popup.querySelector('[data-line="sent"]')?.textContent).toMatch(/Nov 12/), { timeout: 2000 });
      expect(feeds.scrolls.filter((s) => s.feed === body).length).toBe(opened);
      expect(body.scrollTop).toBe(4500);
    } finally {
      feeds.restore();
    }
  });

  it("never moves while an answer streams in, even at the end, and offers Jump to latest instead; 'answering' shows only before its text starts", async () => {
    // Slow enough to look at the answer while it is still being written. The list grows with its text.
    const feeds = layOutFeeds((feed) => 500 + (feed.textContent?.length ?? 0));
    onTestFinished(feeds.restore);
    render(<TestProvider server={fast({ speed: 0.5 })}><App /></TestProvider>);
    await screen.findByLabelText("Message Lead");
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const scroller = conversation().querySelector<HTMLElement>("[data-scroller]")!;
    // Your own line takes you to the end.
    await tell("Lead", "Walk me through the launch post.");
    const streaming = await waitFor(
      () => {
        const last = entries("assistant").at(-1);
        // Caught part-written: it has begun, and not yet ended.
        expect(last?.textContent).toMatch(/^Here is the plan/);
        expect(last?.textContent).not.toMatch(/That is the whole plan\./);
        return last!;
      },
      { interval: 5 },
    );
    // While its text is being written, the text is the sign it is answering: no second line under it.
    expect(within(conversation()).queryByRole("status", OUTSIDE_COMPOSER)).toBeNull();
    const scrolled = feeds.scrolls.length;
    const top = scroller.scrollTop;
    await within(conversation()).findByText(/That is the whole plan\./, {}, { timeout: 4000 });
    // The text grew below the reader: nothing scrolled, and the way down is offered.
    expect(feeds.scrolls.length).toBe(scrolled);
    expect(scroller.scrollTop).toBe(top);
    expect(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeGreaterThan(32);
    expect(within(conversation()).getByRole("button", { name: "Jump to latest" })).toBeTruthy();
    // The growing answer was one node all along.
    expect(entries("assistant").at(-1)).toBe(streaming);
  });

  it("shows an answer while it is written, from the send's own streamed response", async () => {
    // The session stream sends the answer only once it is finished, as the server's does: a part-written
    // answer on screen came through the send's response, which the conversation follows.
    render(<TestProvider server={fast({ speed: 0.5 })}><App /></TestProvider>);
    await screen.findByLabelText("Message Lead");
    await tell("Lead", "Walk me through the launch post.");
    await waitFor(
      () => {
        const last = entries("assistant").at(-1);
        expect(last?.textContent).toMatch(/^Here is the plan/);
        expect(last?.textContent).not.toMatch(/That is the whole plan\./);
      },
      { interval: 5, timeout: 4_000 },
    );
    await within(conversation()).findByText(/That is the whole plan\./, {}, { timeout: 4_000 });
  });

  it("sizes the composer's box to its draft in CSS, so a column that narrows rewraps and regrows it", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    const box = (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
    // One line to start; the browser grows the box with its text (and its width) up to the cap, then it scrolls.
    expect(box.getAttribute("rows")).toBe("1");
    expect(box.classList.contains("field-sizing-content")).toBe(true);
    expect(box.classList.contains("max-h-48")).toBe(true);
    expect(box.style.height).toBe("");
  });

  it("doesn't carry a draft to another worker: switching workers starts an empty box", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    const leadBox = (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
    fireEvent.change(leadBox, { target: { value: "For Lead only" } });
    fireEvent.click(workerRow("researcher"));
    const researcherBox = (await screen.findByLabelText("Message researcher")) as HTMLTextAreaElement;
    expect(researcherBox.value).toBe("");
  });

  it("keeps a line whose send fails, says why, and sends it again on Retry", async () => {
    const lab = fast();
    let refuse = true;
    lab.holdDoor(() => (refuse ? Promise.reject(new Error("the server refused it (401)")) : Promise.resolve()));
    render(<TestProvider server={lab}><App /></TestProvider>);
    const box = (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
    await tell("Lead", "Where is the launch plan?");
    const alert = await within(conversation()).findByRole("alert");
    expect(alert.textContent).toMatch(/Not sent: the server refused it \(401\)/);
    // Nothing typed is lost, and nothing claims it was sent.
    expect(box.value).toBe("Where is the launch plan?");
    expect(entries("user").some((e) => e.textContent?.includes("Where is the launch plan?"))).toBe(false);

    refuse = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(entries("user").some((e) => e.textContent?.includes("Where is the launch plan?"))).toBe(true));
    expect(box.value).toBe("");
    expect(within(conversation()).queryByRole("alert")).toBeNull();
  });

  it("keeps what you typed while a send was in flight once it lands", async () => {
    const lab = fast();
    let land!: () => void;
    lab.holdDoor(() => new Promise<void>((resolve) => (land = resolve)));
    render(<TestProvider server={lab}><App /></TestProvider>);
    const box = (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
    await tell("Lead", "first ask");
    expect(box.value).toBe("first ask");
    expect(within(conversation()).getByRole("button", { name: "Sending…" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "and a second thought" } });
    await act(async () => land());
    await waitFor(() => expect(within(conversation()).getByRole("button", { name: "Send" })).toBeTruthy());
    expect(box.value).toBe("and a second thought");
  });

  it("keeps a draft revised after a reload when the send from before the reload lands", async () => {
    const lab = fast();
    let land!: () => void;
    lab.holdDoor(() => new Promise<void>((resolve) => (land = resolve)));
    const first = render(<TestProvider server={lab}><App /></TestProvider>);
    await tell("Lead", "first ask");
    first.unmount();

    const second = render(<TestProvider server={lab}><App /></TestProvider>);
    const box = (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
    expect(box.value).toBe("first ask");
    fireEvent.change(box, { target: { value: "first ask, revised" } });
    await act(async () => land());
    second.unmount();

    render(<TestProvider server={lab}><App /></TestProvider>);
    expect(((await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement).value).toBe("first ask, revised");
  });

  it("brings an unsent draft back after a reload, for that worker only", async () => {
    const lab = fast();
    const first = render(<TestProvider server={lab}><App /></TestProvider>);
    fireEvent.change(await screen.findByLabelText("Message Lead"), { target: { value: "half a thought" } });
    first.unmount();

    render(<TestProvider server={lab}><App /></TestProvider>);
    expect(((await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement).value).toBe("half a thought");
    fireEvent.click(workerRow("researcher"));
    expect(((await screen.findByLabelText("Message researcher")) as HTMLTextAreaElement).value).toBe("");
  });

  it("sends with Cmd+Enter and Ctrl+Enter as well as Enter, and Shift+Enter stays a new line", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    const box = (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "first line" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(box.value).toBe("first line");
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(entries("user").some((e) => e.textContent?.includes("first line"))).toBe(true));
    fireEvent.change(box, { target: { value: "second line" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(entries("user").some((e) => e.textContent?.includes("second line"))).toBe(true));
  });

  it("doesn't send when Enter ends an input method's composition", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    const box = await screen.findByLabelText("Message Lead");
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
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await waitFor(() => expect(workerRow("writer")).toBeTruthy());
    fireEvent.click(workerRow("writer"));
    await tell("writer", "Publish the draft.");
    const card = await within(conversation()).findByRole("region", { name: "writer asks" });
    expect(card.textContent).toContain("Publish the draft to the team page?");
    expect(card.getAttribute("data-resolution")).toBe("waiting");
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Approve" })));
    await waitFor(() => expect(within(conversation()).getByRole("region", { name: "writer asks" }).getAttribute("data-resolution")).toBe("approved"));
    expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(await within(conversation()).findByText("Published.", {}, { timeout: 2000 })).toBeTruthy();
  });

  it("gives each teammate the icon and color its file sets, the same in the list, the header, a message line and its popup", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3));
    const look = (worker: HTMLElement) => {
      const avatar = worker.querySelector<HTMLElement>("[data-avatar]")!;
      return [avatar.dataset.icon, avatar.dataset.avatar];
    };
    expect(look(workerRow("Lead"))).toEqual(["★", "amber"]);
    expect(look(workerRow("researcher"))).toEqual(["🔎", "teal"]);
    expect(look(workerRow("writer"))).toEqual(["✎", "violet"]);
    expect(look(within(conversation()).getByRole("banner"))).toEqual(["★", "amber"]);

    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
    const line = await within(conversation()).findByRole("button", { name: /^Messaged researcher: / });
    expect(look(line)).toEqual(["🔎", "teal"]);
    fireEvent.click(line);
    expect(look(screen.getByRole("dialog", { name: "Messaged researcher" }))).toEqual(["🔎", "teal"]);
  });

  it("gives a teammate whose file sets no look its initial, on a color of the palette", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await screen.findByLabelText("Message Lead");
    fireEvent.click(screen.getAllByRole("button", { name: "Hire a teammate" })[0]!);
    const form = screen.getByRole("form", { name: "Hire a teammate" });
    fireEvent.change(within(form).getByLabelText("Teammate name"), { target: { value: "tester" } });
    fireEvent.change(within(form).getByLabelText("Teammate role"), { target: { value: "Runs the tests." } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Hire" })));
    const avatar = (await waitFor(() => workerRow("tester").querySelector<HTMLElement>("[data-avatar]")!))!;
    expect(avatar.textContent).toBe("T");
    expect(TEAMMATE_COLORS).toContain(avatar.dataset.avatar);
  });

  it("says under each name what the teammate is doing now, live, from its own state", async () => {
    const { lab, server } = renderOnBoard({ [LEAD]: [] });
    const status = (name: string) => workerRow(name).querySelector("[data-status]")?.textContent;
    const header = () => conversation().querySelector("[data-header-status]")?.textContent;
    await waitFor(() => expect(status("Lead")).toMatch(/^Idle/));
    expect(header()).toMatch(/^Idle/);

    // Lead's turn is held open at its start until both lines have been read: at the tests' pace it runs for 80 ms.
    const release = lab.holdNextTurn("teammates.chief-of-staff");
    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
    await waitFor(() => expect(status("Lead")).toBe("Replying to you"), { interval: 5 });
    await waitFor(() => expect(header()).toBe("Replying to you"), { interval: 5 });
    act(() => release());
    // researcher answers the message it was sent, and says whose.
    await waitFor(() => expect(status("researcher")).toBe("Replying to Lead"), { interval: 5, timeout: 2000 });
    await waitFor(() => expect(status("Lead")).toBe("Messaging researcher"), { interval: 5, timeout: 2000 });
    // Once the reply is in and read, nothing is running: idle, and nothing made up.
    await waitFor(() => expect(status("researcher")).toMatch(/^Idle/), { timeout: 3000 });

    // A coding task its conversation filed runs: the board's row says so.
    server.board[LEAD]!.push(coding("t-1", "cursor"));
    await waitFor(() => expect(status("Lead")).toBe("Running coding task: Fix the typo in the README's first line"), { interval: 5, timeout: 2000 });
    expect(header()).toBe("Running coding task: Fix the typo in the README's first line");
  });

  it("hires with Cmd+Enter in the instructions and saves new ones with Ctrl+Enter, never from a form that can't send yet", async () => {
    render(<TestProvider server={fast()}><App /></TestProvider>);
    await screen.findByLabelText("Message Lead");
    fireEvent.click(screen.getAllByRole("button", { name: "Hire a teammate" })[0]!);
    const form = screen.getByRole("form", { name: "Hire a teammate" });
    const instructions = within(form).getByLabelText("Teammate instructions");
    // No name or role yet: the shortcut sends nothing, as the disabled button wouldn't.
    await act(async () => fireEvent.keyDown(instructions, { key: "Enter", metaKey: true }));
    expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.change(within(form).getByLabelText("Teammate name"), { target: { value: "tester" } });
    fireEvent.change(within(form).getByLabelText("Teammate role"), { target: { value: "Runs the tests." } });
    fireEvent.change(instructions, { target: { value: "Run them all." } });
    // Plain Enter in the instructions is a new line.
    await act(async () => fireEvent.keyDown(instructions, { key: "Enter" }));
    expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3);
    await act(async () => fireEvent.keyDown(instructions, { key: "Enter", metaKey: true }));
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(4));

    await screen.findByLabelText("Message tester");
    fireEvent.click(within(panel("tester")).getByRole("button", { name: "Edit" }));
    const edit = screen.getByRole("form", { name: "Edit tester" });
    const box = within(edit).getByLabelText("New instructions for tester");
    // Nothing changed yet: the shortcut saves nothing.
    await act(async () => fireEvent.keyDown(box, { key: "Enter", ctrlKey: true }));
    expect(screen.getByRole("form", { name: "Edit tester" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "Answer in one sentence." } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter", ctrlKey: true }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit tester" })).toBeNull());
  });

  it("edits a teammate from the conversation's header: Edit teammate opens the form under it, and Reset sits beside it once edited", async () => {
    const lab = fast();
    const resets = () => lab.rosterWrites.filter((w) => w.action === "reset").map((w) => w.input.id);
    render(<TestProvider server={lab} client={stubServer().client}><App /></TestProvider>);
    await waitFor(() => expect(workerRow("researcher")).not.toBeNull());
    fireEvent.click(workerRow("researcher"));
    const open = await within(conversation()).findByRole("button", { name: "Edit teammate" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);
    const edit = within(conversation()).getByRole("form", { name: "Edit researcher" });
    // Not edited yet: nothing to reset.
    expect(within(conversation()).queryByRole("button", { name: /Reset/ })).toBeNull();
    fireEvent.change(within(edit).getByLabelText("Name of researcher"), { target: { value: "Ada" } });
    await act(async () => fireEvent.click(within(edit).getByRole("button", { name: "Save" })));
    // Saved: the form closes and the header names the new name.
    await waitFor(() => expect(within(conversation()).getByRole("heading", { name: "Ada" })).toBeTruthy());
    expect(within(conversation()).queryByRole("form", { name: /^Edit / })).toBeNull();
    fireEvent.click(within(conversation()).getByRole("button", { name: "Edit teammate" }));
    await act(async () => fireEvent.click(within(conversation()).getByRole("button", { name: "Reset Ada to default" })));
    expect(resets()).toEqual(["teammates.researcher"]);
  });

  // FIX-2526.
  it("renames a teammate from the files, and the new name shows in the list, header, task lines and Messaged lines; Reset puts the file's name back", async () => {
    const server = stubServer({ board: { [LEAD]: [codingTask({ id: "t-ask", assignee: "teammates.researcher", title: "Check the launch date", status: "in_progress" })] } });
    const lab = fast();
    // What the panel hands workforce's client: a reset of the file's teammate, by id.
    const resets = () => lab.rosterWrites.filter((w) => w.action === "reset").map((w) => w.input.id);
    render(<TestProvider server={lab} client={server.client}><App /></TestProvider>);
    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
    await within(conversation()).findByRole("button", { name: /^Messaged researcher: / });
    expect(await within(panel("Lead")).findByRole("button", { name: "Asked researcher to check the launch date" })).toBeTruthy();
    // Not edited yet: nothing to reset.
    fireEvent.click(workerRow("researcher"));
    expect(within(panel("researcher")).queryByRole("button", { name: /Reset/ })).toBeNull();

    fireEvent.click(within(panel("researcher")).getByRole("button", { name: "Edit" }));
    const edit = within(panel("researcher")).getByRole("form", { name: "Edit researcher" });
    fireEvent.change(within(edit).getByLabelText("Name of researcher"), { target: { value: "Ada" } });
    await act(async () => fireEvent.click(within(edit).getByRole("button", { name: "Save" })));

    // The list and the header.
    await waitFor(() => expect(workerRow("Ada")).not.toBeNull());
    expect(workerRow("researcher")).toBeNull();
    expect(within(conversation()).getByRole("heading", { name: "Ada" })).toBeTruthy();
    // Lead's conversation: its Messaged line and its task line name Ada.
    fireEvent.click(workerRow("Lead"));
    expect(await within(conversation()).findByRole("button", { name: /^Messaged Ada: / })).toBeTruthy();
    expect(within(panel("Lead")).getByRole("button", { name: "Asked Ada to check the launch date" })).toBeTruthy();

    // Reset to default: the file's name is back everywhere, and there is nothing left to reset.
    fireEvent.click(workerRow("Ada"));
    await act(async () => fireEvent.click(within(panel("Ada")).getByRole("button", { name: "Reset Ada to default" })));
    expect(resets()).toEqual(["teammates.researcher"]);
    await waitFor(() => expect(workerRow("researcher")).not.toBeNull());
    expect(within(panel("researcher")).queryByRole("button", { name: /Reset/ })).toBeNull();
  });

  it("hires a teammate you can talk to, renames it and changes its instructions from its panel, and fires it; the files' workers can't be fired", async () => {
    const lab = fast();
    // What the panel hands workforce's client's edit: the next turn reads it.
    const edits = () => lab.rosterWrites.filter((w) => w.action === "edit").map((w) => w.input);
    render(<TestProvider server={lab}><App /></TestProvider>);
    await screen.findByLabelText("Message Lead");
    // A worker from the files has no fire control.
    expect(within(conversation()).queryByRole("button", { name: "Fire" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Hire a teammate" })[0]!);
    const form = screen.getByRole("form", { name: "Hire a teammate" });
    fireEvent.change(within(form).getByLabelText("Teammate name"), { target: { value: "Tester" } });
    fireEvent.change(within(form).getByLabelText("Teammate role"), { target: { value: "Runs the tests." } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Hire" })));
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(4));
    expect(await screen.findByLabelText("Message tester")).toBeTruthy();

    fireEvent.click(within(panel("tester")).getByRole("button", { name: "Edit" }));
    const edit = within(panel("tester")).getByRole("form", { name: "Edit tester" });
    // The name starts as it is, and can be changed.
    const name = within(edit).getByLabelText("Name of tester") as HTMLInputElement;
    expect([name.value, name.readOnly]).toEqual(["tester", false]);
    fireEvent.change(name, { target: { value: "QA Bot" } });
    fireEvent.change(within(edit).getByLabelText("New instructions for tester"), { target: { value: "Answer in one sentence." } });
    await act(async () => fireEvent.click(within(edit).getByRole("button", { name: "Save" })));
    // The id stays: only the name the list and header show changes.
    expect(edits()).toEqual([{ id: "tester", name: "QA Bot", instructions: "Answer in one sentence." }]);
    await waitFor(() => expect(within(conversation()).getByRole("heading", { name: "QA Bot" })).toBeTruthy());
    expect(workerRow("QA Bot")).not.toBeNull();
    expect(screen.getByLabelText("Message QA Bot")).toBeTruthy();
    // A teammate you hired has no file to go back to.
    expect(within(panel("QA Bot")).queryByRole("button", { name: /Reset/ })).toBeNull();

    // Fire asks in a row under the header, with Keep focused; Keep leaves the teammate where it is.
    window.confirm = () => {
      throw new Error("Fire must not open a browser confirm");
    };
    fireEvent.click(within(conversation()).getByRole("button", { name: "Fire" }));
    const ask = within(conversation()).getByRole("group", { name: "Fire QA Bot?" });
    await waitFor(() => expect(document.activeElement).toBe(within(ask).getByRole("button", { name: "Keep" })));
    fireEvent.click(within(ask).getByRole("button", { name: "Keep" }));
    expect(within(conversation()).queryByRole("group", { name: "Fire QA Bot?" })).toBeNull();
    // Keeping puts focus back on the header's Fire, so the next Tab goes on from where the person was.
    expect(document.activeElement).toBe(within(conversation()).getByRole("button", { name: "Fire" }));
    expect(workerRow("QA Bot")).not.toBeNull();
    fireEvent.click(within(conversation()).getByRole("button", { name: "Fire" }));
    await act(async () => fireEvent.click(within(within(conversation()).getByRole("group", { name: "Fire QA Bot?" })).getByRole("button", { name: "Fire" })));
    await waitFor(() => expect(within(teammates()).getAllByRole("listitem")).toHaveLength(3));
    expect(workerRow("QA Bot")).toBeNull();
  });
});
