// @vitest-environment happy-dom
/**
 * The screen, on fixtures. These prove the UI only: the layout, the result
 * card inside a running turn, and that stopping goes through the main
 * session. The goal check proves the package at wiring.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { App } from "../src/App";
import { createFakeLab } from "./fake-lab";

// The script runs at a hundredth of real time.
const fast = () => createFakeLab({ speed: 0.01 });

// The app keeps what is open in the page's address; each test starts on a bare one.
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session");
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

const thread = () => screen.getByRole("main", { name: "Main thread" });
const pane = () => screen.getByRole("complementary", { name: "Background tasks" });
const row = (title: string) => within(pane()).getByRole("button", { name: new RegExp(title) });

// New session asks for a project before the composer opens; pick one.
async function pick(name = "vendor-notes") {
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name }));
  await screen.findByLabelText("Message the main session");
}


/**
 * Lay the scrolling feeds out as a browser would (happy-dom lays nothing out): the main thread's
 * list and a sheet's body, each 5000px of content in a 500px view, or
 * `height(feed)` px for a test whose content must grow. Every scroll they are asked
 * for is recorded with how it moves, and lands at once. Undone by the returned function.
 */
function layOutFeeds(height: (feed: HTMLElement) => number = () => 5000) {
  const isFeed = (el: HTMLElement) =>
    el.classList.contains("overflow-y-auto") &&
    (el.parentElement?.getAttribute("aria-label") === "Main thread" || el.parentElement?.getAttribute("role") === "dialog");
  const names = ["scrollHeight", "clientHeight", "scrollTop", "scrollTo"] as const;
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);
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
const threadFeed = () => thread().querySelector<HTMLElement>(":scope > .overflow-y-auto")!;

describe("the session-mode screen", () => {
  it("lays out sessions, the main thread and the tasks pane, and opens on New session asking for a project", async () => {
    render(<App adapter={fast()} />);
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    expect(within(sessions).getByText("Draft the launch note")).toBeTruthy();
    await screen.findByRole("region", { name: "Choose a project" });
    expect(screen.queryByLabelText("Message the main session")).toBeNull();
    await pick("vendor-notes");
    expect(within(sessions).getByRole("button", { current: true }).textContent).toMatch(/New session/);
    expect(within(thread()).getByText("in project: vendor-notes")).toBeTruthy();
    expect(within(thread()).getByText("Session")).toBeTruthy();
    expect(within(pane()).getByText(/Background tasks · 0/)).toBeTruthy();
  });

  it("opens no session until a project is picked, even when StrictMode replays the mount", async () => {
    render(
      <StrictMode>
        <App adapter={fast()} />
      </StrictMode>,
    );
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    await screen.findByRole("region", { name: "Choose a project" });
    const blank = () => within(sessions).getAllByRole("listitem").filter((li) => /^New session/.test(li.textContent ?? ""));
    expect(blank()).toHaveLength(0);
    await pick();
    expect(blank()).toHaveLength(1);
  });

  it("sets the mode by view: each view lists only its own main worker's sessions", async () => {
    render(<App adapter={fast()} />);
    const views = screen.getByRole("tablist", { name: "View" });
    const sessionsTab = within(views).getByRole("tab", { name: "Sessions" }) as HTMLButtonElement;
    const projectsTab = within(views).getByRole("tab", { name: "Projects" }) as HTMLButtonElement;
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    expect(sessionsTab.getAttribute("aria-selected")).toBe("true");
    expect(within(sessions).queryByText("Billing triage")).toBeNull();
    fireEvent.click(projectsTab);
    expect(projectsTab.getAttribute("aria-selected")).toBe("true");
    expect(within(sessions).getByText("Billing triage")).toBeTruthy();
    expect(within(sessions).queryByText("Draft the launch note")).toBeNull();
    fireEvent.click(sessionsTab);
    // New session asks only for the project: no mode menu, and no default project.
    await pick();
    fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
    expect(screen.queryByRole("menu")).toBeNull();
    await screen.findByRole("region", { name: "Choose a project" });
    expect(screen.queryByLabelText("Message the main session")).toBeNull();
    await pick("onboarding-app");
    expect(within(thread()).getByText("in project: onboarding-app")).toBeTruthy();
    expect(within(thread()).getByText("Session")).toBeTruthy();
  });

  it("asks for a project instead of opening the composer on a session that has none", async () => {
    render(<App adapter={fast()} />);
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    fireEvent.click(within(sessions).getByRole("button", { name: /Fix the onboarding copy/ }));
    await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe("Fix the onboarding copy"));
    expect(within(thread()).getByRole("note").textContent).toMatch(/Choose a project/);
    expect(within(thread()).getByText("no project")).toBeTruthy();
    expect(screen.queryByLabelText("Message the main session")).toBeNull();
  });

  it("sends with Cmd+Enter and Ctrl+Enter as well as Enter, and Shift+Enter stays a new line", async () => {
    render(<App adapter={fast()} />);
    await pick();
    const box = screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "first line" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(box.value).toBe("first line");
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(box.value).toBe("");
    const mine = () => [...thread().querySelectorAll('[data-entry="user"]')].map((el) => el.textContent ?? "");
    await waitFor(() => expect(mine().join()).toMatch(/first line/));
    fireEvent.change(box, { target: { value: "second line" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(mine().join()).toMatch(/second line/));
  });

  it("doesn't send when Enter only confirms an IME composition", async () => {
    render(<App adapter={fast()} />);
    await pick();
    const box = screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "日本" } });
    // Dispatched natively: fireEvent drops isComposing on the way to React's nativeEvent.
    act(() => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    });
    expect(box.value).toBe("日本");
    // Safari reports the confirming Enter as keyCode 229 instead.
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(box.value).toBe("日本");
    expect(within(thread()).queryByText("日本", { ignore: "textarea" })).toBeNull();
  });

  it("clears an unsent draft when another session is opened, so it can't be sent to the wrong one", async () => {
    render(<App adapter={fast()} />);
    await pick();
    const box = screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "a draft for the new session" } });
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    fireEvent.click(within(sessions).getByRole("button", { name: /Draft the launch note/ }));
    await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe("Draft the launch note"));
    expect((screen.getByLabelText("Message the main session") as HTMLTextAreaElement).value).toBe("");
  });

  it("opens a session already at its end, with no scroll to watch, and leaves you where you scrolled up to as it goes on", async () => {
    const feeds = layOutFeeds();
    onTestFinished(feeds.restore);
    render(<App adapter={fast()} />);
    await pick();
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    fireEvent.click(within(sessions).getByRole("button", { name: /Draft the launch note/ }));
    await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe("Draft the launch note"));
    await waitFor(() => expect(threadFeed().scrollTop).toBe(4500));
    // Opening is never an animation: every move to the end so far was instant.
    expect(feeds.scrolls.length).toBeGreaterThan(0);
    expect(feeds.scrolls.filter((s) => s.behavior !== "instant")).toEqual([]);

    // Up to read: what the running turn adds below doesn't pull you down.
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await ask("Compare Acme and Globex for us.");
    const feed = threadFeed();
    feed.scrollTop = 1200;
    fireEvent.scroll(feed);
    feeds.scrolls.length = 0;
    await within(thread()).findByRole("region", { name: "Background result: Research Acme" });
    expect(feeds.scrolls).toEqual([]);
    expect(feed.scrollTop).toBe(1200);
  });

  it("never moves while the turn writes, even at the end: your own line takes you down, then Jump to latest offers the rest", async () => {
    // The list grows with its text, so what the turn writes lands below the view.
    const feeds = layOutFeeds((feed) => 500 + (feed.textContent?.length ?? 0) * 4);
    onTestFinished(feeds.restore);
    render(<App adapter={fast()} />);
    await pick();
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const feed = threadFeed();
    const opened = feeds.scrolls.length;
    await ask("Compare Acme and Globex for us.");
    // Your own line took you to the end, smoothly: the jump on send, and the line brought in as it landed.
    await within(feed).findByText("Compare Acme and Globex for us.");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = feeds.scrolls.slice(opened);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThanOrEqual(2);
    expect(sent.every((s) => s.feed === feed && s.behavior === "smooth")).toBe(true);
    const scrolled = feeds.scrolls.length;
    await within(thread()).findByRole("region", { name: "Background result: Research Acme" });
    await waitFor(() => expect(within(thread()).queryByRole("status")).toBeNull());
    // Everything after it arrived below: nothing scrolled, and the way down is offered.
    expect(feeds.scrolls.length).toBe(scrolled);
    expect(feed.scrollHeight - feed.scrollTop - feed.clientHeight).toBeGreaterThan(32);
    const jump = within(thread()).getByRole("button", { name: "Jump to latest" });
    fireEvent.click(jump);
    expect(feeds.scrolls.at(-1)).toEqual({ feed, behavior: "smooth" });
    expect(feed.scrollHeight - feed.scrollTop - feed.clientHeight).toBe(0);
    expect(within(thread()).queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it("opens a task's sheet already at the latest of its work", async () => {
    const feeds = layOutFeeds();
    onTestFinished(feeds.restore);
    render(<App adapter={fast()} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Globex")).toBeTruthy());
    feeds.scrolls.length = 0;
    fireEvent.click(row("Research Globex"));
    const body = screen.getByRole("dialog", { name: "Work: Research Globex" }).querySelector<HTMLElement>(":scope > .overflow-y-auto")!;
    expect(body.scrollTop).toBe(4500);
    const opening = feeds.scrolls.filter((s) => s.feed === body);
    expect(opening.length).toBeGreaterThan(0);
    expect(opening.every((s) => s.behavior === "instant")).toBe(true);
  });

  it("shows a background result inside the running turn, then stops the other task when asked", async () => {
    // A twentieth of real time: the card has about 100ms inside the turn, room for a loaded runner to see it.
    render(<App adapter={createFakeLab({ speed: 0.05 })} />);
    await pick();
    await ask("Compare Acme and Globex for us.");

    // Steps 2 and 3: the main session writes, then two task rows appear.
    await waitFor(() => expect(within(pane()).getByText(/Background tasks · 2/)).toBeTruthy());
    expect(within(thread()).getByText(/write the outline myself/)).toBeTruthy();

    // Step 4: the card lands while the working indicator is still on, and the turn goes on to use it.
    const card = await within(thread()).findByRole("region", { name: "Background result: Research Acme" });
    expect(card.dataset.duringTurn).toBe("true");
    expect(within(thread()).getByRole("status").textContent).toMatch(/working/);
    await within(thread()).findByText(/Acme's research is in/);
    expect(row("Research Acme").dataset.taskStatus).toBe("completed");

    // The turn ends with Globex still running.
    await waitFor(() => expect(within(thread()).queryByRole("status")).toBeNull());
    expect(row("Research Globex").dataset.taskStatus).toBe("in_progress");

    // Step 5: stopping is asked of the main session, which cancels its own task.
    await ask("Stop the Globex research.");
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("cancelled"));
    expect(within(thread()).getByText(/Updated a task/)).toBeTruthy();
  });

  it("keeps a task read only: a row opens its work in a sheet over the main thread, with no stop or composer", async () => {
    render(<App adapter={fast()} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Globex")).toBeTruthy());
    fireEvent.click(row("Research Globex"));
    // The sheet sits over the main thread, not squeezed into the pane, and the pane keeps the row picked.
    const work = screen.getByRole("dialog", { name: "Work: Research Globex" });
    expect(within(pane()).queryByRole("dialog")).toBeNull();
    expect(thread().parentElement!.contains(work)).toBe(true);
    expect(row("Research Globex").getAttribute("aria-expanded")).toBe("true");
    expect(within(work).getByText(/Starting:/)).toBeTruthy();
    // What its run has spent so far, split as the board's row reports it.
    expect(within(work).getByText("openai/gpt-6-luna · 1.2k in · 300 out")).toBeTruthy();
    expect(within(work).getByText(/To stop or steer a task, ask the main session/)).toBeTruthy();
    expect(within(work).queryByRole("button", { name: /stop|cancel/i })).toBeNull();
    expect(within(work).queryByRole("textbox")).toBeNull();
  });

  it("closes the sheet with Esc, its close button, or a click on the thread around it, and leaves the thread in place", async () => {
    render(<App adapter={fast()} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Globex")).toBeTruthy());
    const sheet = () => screen.queryByRole("dialog", { name: "Work: Research Globex" });

    fireEvent.click(row("Research Globex"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(sheet()).toBeNull();

    fireEvent.click(row("Research Globex"));
    fireEvent.click(within(sheet()!).getByRole("button", { name: "Close" }));
    expect(sheet()).toBeNull();

    fireEvent.click(row("Research Globex"));
    // A click inside the sheet keeps it; one on the backdrop over the thread closes it.
    fireEvent.click(within(sheet()!).getByText(/Starting:/));
    expect(sheet()).not.toBeNull();
    fireEvent.click(sheet()!.parentElement!);
    expect(sheet()).toBeNull();
    expect(within(thread()).getByRole("textbox", { name: "Message the main session" })).toBeTruthy();
    expect(within(thread()).getAllByText("Compare Acme and Globex for us.").length).toBeGreaterThan(0);
  });

  it("folds finished tasks into a collapsed Done group of one-line rows, and counts only the active ones", async () => {
    render(<App adapter={fast()} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Acme").dataset.taskStatus).toBe("completed"));
    // Acme is done and Globex still runs: one card, one done row, and the count is the active one.
    expect(within(pane()).getByText(/Background tasks · 1/)).toBeTruthy();
    const done = within(pane()).getByText(/Done · 1/).closest("details")!;
    expect(done.open).toBe(false);
    expect(within(done).getByRole("button", { name: /Research Acme/, hidden: true })).toBeTruthy();
    expect(within(done).queryByText("Research Globex")).toBeNull();
    // The running card shows its live count; the done row, the final total its run reported.
    expect(within(row("Research Globex")).getByText("openai/gpt-6-luna · 1.5k tokens").dataset.spend).toBe("live");
    expect(within(done).getByText("openai/gpt-6-luna · 6.3k tokens", { selector: "[data-spend]" }).dataset.spend).toBe("final");

    // A finished row still opens like any task.
    done.open = true;
    fireEvent.click(within(done).getByRole("button", { name: /Research Acme/ }));
    expect(screen.getByRole("dialog", { name: "Work: Research Acme" })).toBeTruthy();
  });

  it("queues a line sent while a turn runs, and runs it after", async () => {
    render(<App adapter={createFakeLab({ speed: 0.2 })} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status");
    await ask("Also add a risks section.");
    expect(within(thread()).getByText(/queued · runs when this turn ends/)).toBeTruthy();
    await within(thread()).findByText(/Noted\./, undefined, { timeout: 4000 });
  });

  it("interrupts the running turn with Stop", async () => {
    render(<App adapter={fast()} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status");
    fireEvent.click(within(thread()).getByRole("button", { name: "Stop" }));
    await within(thread()).findByText(/Interrupted/);
    expect(within(thread()).queryByRole("status")).toBeNull();
  });

  it("never stops the turn on one Esc, in the composer or when it closes a sheet", async () => {
    render(<App adapter={createFakeLab({ speed: 0.2 })} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status");
    const box = screen.getByLabelText("Message the main session");
    // Esc in the text box is the box's, however many times it is pressed.
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.keyDown(box, { key: "Escape" });
    // An Esc that closes a sheet is spent, even with the second Esc right behind it.
    await waitFor(() => expect(row("Research Globex")).toBeTruthy());
    fireEvent.click(row("Research Globex"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Work: Research Globex" })).toBeNull();
    expect(within(thread()).queryByText(/press Esc again/)).toBeNull();
    // The next Esc only arms: the one that closed the sheet did not count as the first.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(within(thread()).getByText(/press Esc again/)).toBeTruthy();
    expect(within(thread()).getByRole("status")).toBeTruthy();
    expect(within(thread()).queryByText(/Interrupted/)).toBeNull();
  });

  it("stops the turn on Esc twice, from outside the text box", async () => {
    render(<App adapter={createFakeLab({ speed: 0.2 })} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(within(thread()).getByText(/press Esc again to stop the turn/)).toBeTruthy();
    expect(within(thread()).queryByText(/Interrupted/)).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await within(thread()).findByText(/Interrupted/);
  });

  it("stops the turn on Cmd+. from the composer", async () => {
    render(<App adapter={createFakeLab({ speed: 0.2 })} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status");
    fireEvent.keyDown(screen.getByLabelText("Message the main session"), { key: ".", metaKey: true });
    await within(thread()).findByText(/Interrupted/);
  });

  it("keeps background tasks running when the turn that filed them is interrupted", async () => {
    render(<App adapter={createFakeLab({ speed: 0.1 })} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(within(pane()).getByText(/Background tasks · 2/)).toBeTruthy());
    expect(row("Research Acme").dataset.taskStatus).toBe("in_progress");
    fireEvent.click(within(thread()).getByRole("button", { name: "Stop" }));
    await within(thread()).findByText(/Background tasks keep running/);
    await waitFor(() => expect(row("Research Acme").dataset.taskStatus).toBe("completed"), { timeout: 2000 });
  });
});
