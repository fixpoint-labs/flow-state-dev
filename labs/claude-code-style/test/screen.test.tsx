// @vitest-environment happy-dom
/**
 * The session-mode screen, on the lab's own host with the models scripted
 * (`vendorScripts`): the layout, the result card inside a running turn, and
 * that stopping goes through the main session.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import type { ClientFetch } from "@flow-state-dev/client";
import { App } from "../src/components/App";
import { modeById } from "../src/modes";
import { layOutFeeds } from "./feed-layout";
import { closeApps, openTestApp, repository, seedSession, vendorScripts, type TestApp, type TestAppOptions, type VendorControl, type VendorOptions } from "./app-host";

// The app keeps what is open in the page's address, and drafts in storage across a reload;
// each test starts on a bare address with no one else's drafts.
afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  await closeApps();
});

/** Long enough for a read of the in-process host, which hears no push and reads on its timer. */
const SLOW = { timeout: 15_000 };

let lab: TestApp;
let control: VendorControl;

/**
 * The lab's own host with the vendor scripts and two projects, `vendor-notes` and `onboarding-app`;
 * `seeded`, with the sessions someone who used the lab before has: "Draft the launch note" in the
 * Sessions view, "Billing triage" in the Projects view, and "Fix the onboarding copy", opened on no project.
 */
async function openAppHost(options: { seeded?: boolean; vendor?: VendorOptions; host?: TestAppOptions } = {}): Promise<TestApp> {
  const vendor = vendorScripts(options.vendor);
  control = vendor.control;
  lab = await openTestApp({ scripts: vendor.scripts, ...options.host });
  await lab.calls.createProject("onboarding-app", `file://${repository(join(lab.data, "onboarding"))}`);
  if (options.seeded) {
    await seedSession(lab, "session", "Draft the launch note");
    await seedSession(lab, "threads", "Billing triage");
    // A session from before every session opened on a project.
    const worker = modeById("session").worker;
    const flow = (await lab.client.sessions.get(await seedSession(lab, "session", "Warm up"))).flowKind;
    const { id } = await lab.client.flow(flow).createSession({ state: { workerId: worker } });
    await lab.calls.send(id, "Fix the onboarding copy");
  }
  return lab;
}

/** The app on {@link openAppHost}'s host. */
async function renderApp(options: Parameters<typeof openAppHost>[0] = {}) {
  await openAppHost(options);
  render(lab.wrap(<App />));
}

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session", undefined, SLOW);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

const thread = () => screen.getByRole("main", { name: "Main thread" });
/** A status line of the thread itself: the composer's attachment notices are a status region too. */
const OUTSIDE_COMPOSER = { name: (_name: string, element: Element) => element.closest("form") === null };
const pane = () => screen.getByRole("complementary", { name: "Background tasks" });
const row = (title: string) => within(pane()).getByRole("button", { name: new RegExp(title), hidden: true });

// New session asks for a project before the composer opens; pick one.
async function pick(name = "vendor-notes") {
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name }, SLOW));
  await screen.findByLabelText("Message the main session", undefined, SLOW);
}

const threadFeed = () => thread().querySelector<HTMLElement>(":scope > .overflow-y-auto")!;

describe("the session-mode screen", () => {
  it("lays out sessions, the main thread and the tasks pane, and opens on New session asking for a project", async () => {
    await renderApp({ seeded: true });
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    expect(await within(sessions).findByText("Draft the launch note", undefined, SLOW)).toBeTruthy();
    await screen.findByRole("region", { name: "Choose a project" });
    expect(screen.queryByLabelText("Message the main session")).toBeNull();
    await pick("vendor-notes");
    // A new session reads Untitled until its title is written.
    await waitFor(() => expect(within(sessions).getByRole("button", { current: true }).textContent).toMatch(/Untitled/), SLOW);
    expect(within(thread()).getByText("in project: vendor-notes")).toBeTruthy();
    // The view switch names the mode once; the thread header carries no second, inert label for it.
    expect(within(thread()).queryByText("Session")).toBeNull();
    // No tasks: the heading counts nothing, never a 0.
    expect(within(pane()).getByText(/^Background tasks$/)).toBeTruthy();
  });

  it("opens no session until a project is picked, even when StrictMode replays the mount", async () => {
    await openAppHost();
    render(
      <StrictMode>
        {lab.wrap(<App />)}
      </StrictMode>,
    );
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    await screen.findByRole("region", { name: "Choose a project" });
    const blank = () => within(sessions).queryAllByRole("listitem").filter((li) => /^Untitled/.test(li.textContent ?? ""));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(blank()).toHaveLength(0);
    await pick();
    await waitFor(() => expect(blank()).toHaveLength(1), SLOW);
    // And no second one comes after.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(blank()).toHaveLength(1);
  });

  it("sets the mode by view: each view lists only its own main worker's sessions", async () => {
    await renderApp({ seeded: true });
    const views = screen.getByRole("tablist", { name: "View" });
    const sessionsTab = within(views).getByRole("tab", { name: "Sessions" }) as HTMLButtonElement;
    const projectsTab = within(views).getByRole("tab", { name: "Projects" }) as HTMLButtonElement;
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    expect(sessionsTab.getAttribute("aria-selected")).toBe("true");
    await within(sessions).findByText("Draft the launch note", undefined, SLOW);
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
    await waitFor(() => expect(within(thread()).getByText("in project: onboarding-app")).toBeTruthy(), SLOW);
    // The view switch names the mode once; the thread header carries no second, inert label for it.
    expect(within(thread()).queryByText("Session")).toBeNull();
  });

  it("asks for a project instead of opening the composer on a session that has none", async () => {
    await renderApp({ seeded: true });
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    fireEvent.click(await within(sessions).findByRole("button", { name: /Fix the onboarding copy/ }, SLOW));
    await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe("Fix the onboarding copy"), SLOW);
    expect(within(thread()).getByRole("note").textContent).toMatch(/Choose a project/);
    expect(within(thread()).getByText("no project")).toBeTruthy();
    expect(screen.queryByLabelText("Message the main session")).toBeNull();
  });

  it("sends with Cmd+Enter and Ctrl+Enter as well as Enter, and Shift+Enter stays a new line", async () => {
    await renderApp();
    await pick();
    const box = screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "first line" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(box.value).toBe("first line");
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    // The box empties once the send lands.
    await waitFor(() => expect(box.value).toBe(""), SLOW);
    const mine = () => [...thread().querySelectorAll('[data-entry="user"]')].map((el) => el.textContent ?? "");
    await waitFor(() => expect(mine().join()).toMatch(/first line/), SLOW);
    fireEvent.change(box, { target: { value: "second line" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(mine().join()).toMatch(/second line/), SLOW);
  });

  it("doesn't send when Enter only confirms an IME composition", async () => {
    await renderApp();
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

  it("keeps a line whose send fails, says why, and sends it again on Retry", async () => {
    let refuse = true;
    // The main session's door refuses the send, as an expired sign-in does.
    const refusing = (inner: ClientFetch): ClientFetch =>
      (async (input, init) => {
        if (refuse && init?.method === "POST" && String(input instanceof Request ? input.url : input).endsWith("/actions/respond")) throw new Error("the server refused it (401)");
        return inner(input, init);
      }) as ClientFetch;
    await renderApp({ host: { intercept: refusing } });
    await pick();
    const box = screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    const mine = () => [...thread().querySelectorAll('[data-entry="user"]')].map((el) => el.textContent ?? "");
    await ask("Summarize the vendor notes");
    const alert = await within(thread()).findByRole("alert", undefined, SLOW);
    expect(alert.textContent).toMatch(/Not sent: the server refused it \(401\)/);
    // Nothing typed is lost, and nothing claims it was sent.
    expect(box.value).toBe("Summarize the vendor notes");
    expect(mine()).toEqual([]);

    refuse = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mine().join()).toMatch(/Summarize the vendor notes/), SLOW);
    expect(box.value).toBe("");
    expect(within(thread()).queryByRole("alert")).toBeNull();
  });

  it("keeps what you typed while a send was in flight once it lands", async () => {
    await renderApp();
    await pick();
    const box = screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    // The send is held on its way to the main session's door.
    const land = lab.hold("/actions/respond");
    await ask("first ask");
    expect(box.value).toBe("first ask");
    expect(within(thread()).getByRole("button", { name: "Sending…" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "and a second thought" } });
    await act(async () => land());
    await waitFor(() => expect(within(thread()).getByRole("button", { name: "Send" })).toBeTruthy(), SLOW);
    expect(box.value).toBe("and a second thought");
  });

  it("keeps a draft revised after a reload when the send from before the reload lands", async () => {
    await openAppHost({ seeded: true });
    const open = async () => {
      await pick();
      fireEvent.click(await within(screen.getByRole("navigation", { name: "Sessions" })).findByRole("button", { name: /Draft the launch note/ }, SLOW));
      await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe("Draft the launch note"), SLOW);
      return screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    };
    const first = render(lab.wrap(<App />));
    const box = await open();
    // The send is held on its way to the main session's door.
    const land = lab.hold("/actions/respond");
    await act(async () => {
      fireEvent.change(box, { target: { value: "tighten the intro" } });
      fireEvent.keyDown(box, { key: "Enter" });
    });
    first.unmount();

    // A reload reopens the session the address names.
    const reopened = async () => {
      await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe("Draft the launch note"), SLOW);
      return screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    };
    const second = render(lab.wrap(<App />));
    const again = await reopened();
    expect(again.value).toBe("tighten the intro");
    fireEvent.change(again, { target: { value: "tighten the intro, and the outro" } });
    await act(async () => land());
    second.unmount();

    render(lab.wrap(<App />));
    expect((await reopened()).value).toBe("tighten the intro, and the outro");
  });

  it("brings an unsent draft back after a reload, for its own session only", async () => {
    await openAppHost({ seeded: true });
    const open = async (title: RegExp, heading: string) => {
      fireEvent.click(await within(screen.getByRole("navigation", { name: "Sessions" })).findByRole("button", { name: title }, SLOW));
      await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe(heading), SLOW);
      return screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    };
    const first = render(lab.wrap(<App />));
    await pick();
    fireEvent.change(await open(/Draft the launch note/, "Draft the launch note"), { target: { value: "half a thought" } });
    first.unmount();

    // A reload reopens the session the address names, with its draft.
    const second = render(lab.wrap(<App />));
    await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe("Draft the launch note"), SLOW);
    expect((screen.getByLabelText("Message the main session") as HTMLTextAreaElement).value).toBe("half a thought");
    second.unmount();

    // A page opened on no session starts a new one, and the draft stays with its own.
    window.history.replaceState(null, "", "/");
    render(lab.wrap(<App />));
    await pick();
    expect((screen.getByLabelText("Message the main session") as HTMLTextAreaElement).value).toBe("");
    expect((await open(/Draft the launch note/, "Draft the launch note")).value).toBe("half a thought");
  });

  it("clears an unsent draft when another session is opened, so it can't be sent to the wrong one", async () => {
    await renderApp({ seeded: true });
    await pick();
    const box = screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "a draft for the new session" } });
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    fireEvent.click(await within(sessions).findByRole("button", { name: /Draft the launch note/ }, SLOW));
    await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe("Draft the launch note"), SLOW);
    expect((screen.getByLabelText("Message the main session") as HTMLTextAreaElement).value).toBe("");
  });

  it("opens a session already at its end, with no scroll to watch, and leaves you where you scrolled up to as it goes on", async () => {
    const feeds = layOutFeeds();
    onTestFinished(feeds.restore);
    await renderApp({ seeded: true, vendor: { mainTurn: "takes-acme" } });
    await pick();
    const sessions = screen.getByRole("navigation", { name: "Sessions" });
    fireEvent.click(await within(sessions).findByRole("button", { name: /Draft the launch note/ }, SLOW));
    await waitFor(() => expect(within(thread()).getByRole("heading").textContent).toBe("Draft the launch note"), SLOW);
    await waitFor(() => expect(threadFeed().scrollTop).toBe(4500), SLOW);
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
    await within(thread()).findByRole("region", { name: "Background result: Research Acme" }, SLOW);
    expect(feeds.scrolls).toEqual([]);
    expect(feed.scrollTop).toBe(1200);
  });

  it("never moves while the turn writes, even at the end: your own line takes you down, then Jump to latest offers the rest", async () => {
    // The list grows with its text, so what the turn writes lands below the view. Like a browser's,
    // its scroll height also counts the space the feed keeps under your line, which is padding.
    const content = (feed: HTMLElement) => 500 + (feed.textContent?.length ?? 0) * 4;
    const feeds = layOutFeeds((feed) => content(feed) + (Number.parseFloat(feed.style.paddingBottom) || 0));
    onTestFinished(feeds.restore);
    await renderApp({ vendor: { mainTurn: "takes-acme" } });
    await pick();
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const feed = threadFeed();
    const opened = feeds.scrolls.length;
    await ask("Compare Acme and Globex for us.");
    // Your own line took you to the end, smoothly: the jump on send, and the line brought in as it landed.
    await within(feed).findByText("Compare Acme and Globex for us.", undefined, SLOW);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = feeds.scrolls.slice(opened);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThanOrEqual(2);
    expect(sent.every((s) => s.feed === feed && s.behavior === "smooth")).toBe(true);
    const scrolled = feeds.scrolls.length;
    await within(thread()).findByRole("region", { name: "Background result: Research Acme" }, SLOW);
    await waitFor(() => expect(within(thread()).queryByRole("status", OUTSIDE_COMPOSER)).toBeNull(), SLOW);
    // Everything after it arrived below: nothing scrolled.
    expect(feeds.scrolls.length).toBe(scrolled);
    expect(feed.scrollHeight - feed.scrollTop - feed.clientHeight).toBeGreaterThan(32);
    // Read back up, and the way down is offered. (happy-dom lays out no space under your line, so
    // whether the reply alone outgrew it is the hook's own test's: `useJumpToLatest.test.ts`.)
    feed.scrollTop = 0;
    fireEvent.scroll(feed);
    const jump = await within(thread()).findByRole("button", { name: "Jump to latest" }, SLOW);
    fireEvent.click(jump);
    expect(feeds.scrolls.at(-1)).toEqual({ feed, behavior: "smooth" });
    // At the end of what was written, whatever space is still kept below it.
    expect(content(feed) - feed.scrollTop - feed.clientHeight).toBe(0);
    expect(within(thread()).queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it("opens a task's sheet already at the latest of its work", async () => {
    const feeds = layOutFeeds();
    onTestFinished(feeds.restore);
    await renderApp();
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Globex")).toBeTruthy(), SLOW);
    feeds.scrolls.length = 0;
    fireEvent.click(row("Research Globex"));
    const body = screen.getByRole("dialog", { name: "Work: Research Globex" }).querySelector<HTMLElement>(":scope > .overflow-y-auto")!;
    await waitFor(() => expect(body.scrollTop).toBe(4500), SLOW);
    const opening = feeds.scrolls.filter((s) => s.feed === body);
    expect(opening.length).toBeGreaterThan(0);
    expect(opening.every((s) => s.behavior === "instant")).toBe(true);
  });

  it("shows a background result inside the running turn, then stops the other task when asked", async () => {
    // The main turn runs on past Acme's settling, so the card lands inside it.
    await renderApp({ vendor: { mainTurn: "takes-acme" } });
    await pick();
    await ask("Compare Acme and Globex for us.");

    // The main session starts two tasks.
    await waitFor(() => expect(row("Research Globex")).toBeTruthy(), SLOW);

    // The card lands while the working indicator is still on, and the turn goes on to use it.
    const card = await within(thread()).findByRole("region", { name: "Background result: Research Acme" }, SLOW);
    expect(card.dataset.duringTurn).toBe("true");
    expect(within(thread()).getByRole("status", OUTSIDE_COMPOSER).textContent).toMatch(/working/);
    await within(thread()).findByText(/Acme's research is in/, undefined, SLOW);
    await waitFor(() => expect(row("Research Acme").dataset.taskStatus).toBe("completed"), SLOW);

    // The turn ends with Globex still running.
    await waitFor(() => expect(within(thread()).queryByRole("status", OUTSIDE_COMPOSER)).toBeNull(), SLOW);
    expect(row("Research Globex").dataset.taskStatus).toBe("in_progress");

    // Stopping is asked of the main session, which cancels its own task.
    await ask("Stop the Globex research.");
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("cancelled"), SLOW);
    expect(within(thread()).getAllByText(/Update a task/).length).toBeGreaterThan(0);
  });

  it("opens a task's work in a sheet over the main thread, with its action row and no composer", async () => {
    await renderApp();
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Globex")).toBeTruthy(), SLOW);
    fireEvent.click(row("Research Globex"));
    // The sheet sits over the main thread, not squeezed into the pane, and the pane keeps the row picked.
    const work = screen.getByRole("dialog", { name: "Work: Research Globex" });
    expect(within(pane()).queryByRole("dialog")).toBeNull();
    expect(thread().parentElement!.contains(work)).toBe(true);
    expect(row("Research Globex").getAttribute("aria-expanded")).toBe("true");
    // What it was handed, folded.
    await within(work).findByText(/Task brief/, undefined, SLOW);
    // Its changes are the action row's (`task-actions.test.tsx`); the sheet has no composer of its own.
    expect(within(work).getByTestId("task-action-row")).toBeTruthy();
    expect(within(work).queryByRole("textbox", { name: /message/i })).toBeNull();
  });

  it("closes the sheet with Esc, its close button, or a click on the thread around it, and leaves the thread in place", async () => {
    await renderApp();
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Globex")).toBeTruthy(), SLOW);
    const sheet = () => screen.queryByRole("dialog", { name: "Work: Research Globex" });
    // Opened from the row, then worked in: focus is in the sheet when it closes, and goes back to the row.
    const open = () => {
      row("Research Globex").focus();
      fireEvent.click(row("Research Globex"));
      within(sheet()!).getByRole("button", { name: "Close" }).focus();
    };

    open();
    // The Esc that closes is spent, so it never also stops a turn.
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(false);
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(row("Research Globex"));

    open();
    fireEvent.click(within(sheet()!).getByRole("button", { name: "Close" }));
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(row("Research Globex"));

    open();
    // A click inside the sheet keeps it; one on the backdrop over the thread closes it.
    fireEvent.click(await within(sheet()!).findByText(/Task brief/, undefined, SLOW));
    expect(sheet()).not.toBeNull();
    fireEvent.click(sheet()!.parentElement!);
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(row("Research Globex"));
    expect(within(thread()).getByRole("textbox", { name: "Message the main session" })).toBeTruthy();
    expect(within(thread()).getAllByText("Compare Acme and Globex for us.").length).toBeGreaterThan(0);
  });

  it("keeps the pane live under the sheet: another task picked there shows in the same sheet, and focus goes back to that row", async () => {
    await renderApp();
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Acme").dataset.taskStatus).toBe("completed"), SLOW);
    fireEvent.click(row("Research Globex"));
    expect(screen.getByRole("dialog", { name: "Work: Research Globex" })).toBeTruthy();

    // The sheet holds no focus: the pane's other row takes it, and a click there swaps what the sheet shows.
    const done = within(pane()).getByText(/Done · 1/).closest("details")!;
    done.open = true;
    const acme = within(done).getByRole("button", { name: /Research Acme/ });
    acme.focus();
    fireEvent.click(acme);
    expect(document.activeElement).toBe(acme);
    const work = screen.getByRole("dialog", { name: "Work: Research Acme" });
    expect(screen.queryByRole("dialog", { name: "Work: Research Globex" })).toBeNull();

    within(work).getByRole("button", { name: "Close" }).focus();
    fireEvent.click(within(work).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(acme);
  });

  it("folds finished tasks into a collapsed Done group of one-line rows, and counts each state", async () => {
    await renderApp();
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Acme").dataset.taskStatus).toBe("completed"), SLOW);
    // Acme is done and Globex still runs: one card, one done row, and the heading counts each.
    await waitFor(() => expect(within(pane()).getByText(/^Background tasks · 1 running · 1 done$/)).toBeTruthy(), SLOW);
    const done = within(pane()).getByText(/Done · 1/).closest("details")!;
    expect(done.open).toBe(false);
    expect(within(done).getByRole("button", { name: /Research Acme/, hidden: true })).toBeTruthy();
    expect(within(done).queryByText("Research Globex")).toBeNull();
    // The running card's spend is live (`spend.test.ts` draws a final one).
    await waitFor(() => expect(row("Research Globex").querySelector("[data-spend]")?.getAttribute("data-spend")).toBe("live"), SLOW);

    // A finished row still opens like any task.
    done.open = true;
    fireEvent.click(within(done).getByRole("button", { name: /Research Acme/ }));
    expect(screen.getByRole("dialog", { name: "Work: Research Acme" })).toBeTruthy();
  });

  it("opens a task from its result line in the pane's sheet, and opens Done to show its row marked", async () => {
    await renderApp();
    await pick();
    await ask("Compare Acme and Globex for us.");
    const result = await within(thread()).findByRole("region", { name: "Background result: Research Acme" }, SLOW);
    await waitFor(() => expect(row("Research Acme").dataset.taskStatus).toBe("completed"), SLOW);
    const done = within(pane()).getByText(/Done · 1/).closest("details")!;
    expect(done.open).toBe(false);

    fireEvent.click(within(result).getByRole("button", { name: "Open task" }));
    expect(screen.getByRole("dialog", { name: "Work: Research Acme" })).toBeTruthy();
    // One selection: the pane marks the same row, and its shut Done group opens to show it.
    await waitFor(() => expect(done.open).toBe(true));
    expect(within(done).getByRole("button", { name: /Research Acme/ }).getAttribute("aria-expanded")).toBe("true");
    // The fold still opens to the reply.
    fireEvent.click(within(result).getByRole("button", { name: /Research Acme/ }));
    expect(within(result).getByRole("button", { name: /Research Acme/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("opens a task from the line where the main session started it, with the task's status on its dot", async () => {
    await renderApp();
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(row("Research Globex").dataset.taskStatus).toBe("in_progress"), SLOW);
    // Each call that filed a task is that task's line, not a step of the turn's run.
    await waitFor(() => expect(within(thread()).getAllByText(/Start a task: Research Globex/).length).toBeGreaterThan(0), SLOW);
    const start = within(thread())
      .getAllByText(/Start a task: Research Globex/)
      .map((el) => el.closest("[data-task-id]") as HTMLElement | null)
      .find((el) => el !== null)!;
    await waitFor(() => expect(start.querySelector("[data-task-dot]")!.getAttribute("aria-label")).toBe("running"), SLOW);
    fireEvent.click(within(start).getByRole("button", { name: "Open task" }));
    expect(screen.getByRole("dialog", { name: "Work: Research Globex" })).toBeTruthy();
    expect(row("Research Globex").getAttribute("aria-expanded")).toBe("true");
  });

  it("reads a session's tasks once, for the main thread and the pane together, in either mode", async () => {
    // Each read of the coding board, by the session it was asked for, as the page's calls carry it.
    const reads: string[] = [];
    const counting = (inner: ClientFetch): ClientFetch =>
      (async (input, init) => {
        if (String(input instanceof Request ? input.url : input).endsWith("/views/codingBoard")) reads.push((JSON.parse(String(init?.body)) as { input: { sessionId: string } }).input.sessionId);
        return inner(input, init);
      }) as ClientFetch;
    await renderApp({ host: { intercept: counting } });
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("region", { name: "Background result: Research Acme" }, SLOW);
    const sessionMode = new Set(reads);
    const readsBefore = reads.length;
    // One watch for the thread and the pane: two would read twice as often.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const perPoll = (reads.length - readsBefore) / (1_500 / 150);
    // Threads mode: its main thread draws cards from the rows its board lists.
    fireEvent.click(within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name: "Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
    await pick();
    await ask("Research three vendors for a status page, one thread each.");
    await waitFor(() => expect(within(thread()).getAllByRole("region", { name: /^Task: / }).length).toBeGreaterThan(0), SLOW);
    expect(sessionMode.size).toBe(1);
    expect(new Set(reads).size).toBe(2);
    expect(perPoll).toBeLessThanOrEqual(1.5);
  });

  it("answers a line sent while a turn runs at once, beside the turn, and never says it waits", async () => {
    await renderApp({ vendor: { mainTurn: "until-stopped" } });
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status", OUTSIDE_COMPOSER, SLOW);
    await ask("Also add a risks section.");
    // Its answer lands while the first turn still runs: that turn's own closing line hasn't.
    await within(thread()).findByText(/Noted\./, undefined, SLOW);
    expect(within(thread()).queryByText(/write the outline myself/)).toBeNull();
    expect(within(thread()).queryByText(/queued|runs when this turn ends|waits/i)).toBeNull();
  });

  it("interrupts the running turn with Stop", async () => {
    await renderApp({ vendor: { mainTurn: "until-stopped" } });
    await pick();
    await ask("Compare Acme and Globex for us.");
    const working = await within(thread()).findByRole("status", OUTSIDE_COMPOSER, SLOW);
    const stoppedTurn = working.getAttribute("data-request-id");
    expect(stoppedTurn).toBeTruthy();
    fireEvent.click(within(thread()).getByRole("button", { name: "Stop" }));
    const stopped = await within(thread()).findByText(/Interrupted by you/, undefined, SLOW);
    // The turn Stop reached is the one that reads Interrupted, and its working line is gone. Asked of
    // that turn, not of any working line: the research result the worker takes once the stopped turn
    // ends is a turn of its own, which Stop never reached and which can be working by now. The stopped
    // line and the working line come from one read of the session's turns, so this is read once.
    expect(stopped.closest("[data-request-id]")?.getAttribute("data-request-id")).toBe(stoppedTurn);
    expect(thread().querySelector(`[role="status"][data-request-id="${stoppedTurn}"]`)).toBeNull();
  });

  it("never stops the turn on one Esc, in the composer or when it closes a sheet", async () => {
    await renderApp({ vendor: { mainTurn: "until-stopped" } });
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status", OUTSIDE_COMPOSER, SLOW);
    const box = screen.getByLabelText("Message the main session");
    // Esc in the text box is the box's, however many times it is pressed.
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.keyDown(box, { key: "Escape" });
    // An Esc that closes a sheet is spent, even with the second Esc right behind it.
    await waitFor(() => expect(row("Research Globex")).toBeTruthy(), SLOW);
    fireEvent.click(row("Research Globex"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Work: Research Globex" })).toBeNull();
    expect(within(thread()).queryByText(/press Esc again/)).toBeNull();
    // The next Esc only arms: the one that closed the sheet did not count as the first.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(within(thread()).getByText(/press Esc again/)).toBeTruthy();
    expect(within(thread()).getByRole("status", OUTSIDE_COMPOSER)).toBeTruthy();
    expect(within(thread()).queryByText(/Interrupted/)).toBeNull();
  });

  it("stops the turn on Esc twice, from outside the text box", async () => {
    await renderApp({ vendor: { mainTurn: "until-stopped" } });
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status", OUTSIDE_COMPOSER, SLOW);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(within(thread()).getByText(/press Esc again to stop the turn/)).toBeTruthy();
    expect(within(thread()).queryByText(/Interrupted/)).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await within(thread()).findByText(/Interrupted/, undefined, SLOW);
  });

  it("stops the turn on Cmd+. from the composer", async () => {
    await renderApp({ vendor: { mainTurn: "until-stopped" } });
    await pick();
    await ask("Compare Acme and Globex for us.");
    await within(thread()).findByRole("status", OUTSIDE_COMPOSER, SLOW);
    fireEvent.keyDown(screen.getByLabelText("Message the main session"), { key: ".", metaKey: true });
    await within(thread()).findByText(/Interrupted/, undefined, SLOW);
  });

  it("keeps background tasks running when the turn that filed them is interrupted", async () => {
    await renderApp({ vendor: { mainTurn: "until-stopped", holdAcme: true } });
    await pick();
    await ask("Compare Acme and Globex for us.");
    await waitFor(() => expect(within(pane()).getByText(/^Background tasks · 2 running$/)).toBeTruthy(), SLOW);
    expect(row("Research Acme").dataset.taskStatus).toBe("in_progress");
    fireEvent.click(within(thread()).getByRole("button", { name: "Stop" }));
    await within(thread()).findByText(/Interrupted by you · 2 background tasks still running/, undefined, SLOW);
    control.releaseAcme();
    await waitFor(() => expect(row("Research Acme").dataset.taskStatus).toBe("completed"), SLOW);
  });
});
