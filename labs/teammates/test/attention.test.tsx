// @vitest-environment happy-dom
/**
 * From any tab, you can tell when Teammates needs you and which teammate it
 * is (FIX-2397). A teammate that waits on your yes, or whose task waits on
 * you, says so first on its line, with a badge; a coding task that just ended
 * says so for two minutes; the tab's title counts the teammates with
 * something for you; and *Notify me* sends a desktop notification while the
 * tab is in the background, once per new thing, never while it is off.
 *
 * Red states produced before this was trusted: on `main` the status line has
 * no need tier and no ending line, the title never changes, and there is no
 * notifier, so every case fails; let the notifier fire with the tab in front
 * and the notifier case fails; count unread lines instead of teammates and
 * the title case fails.
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { approval as approvalItem, answered, linesOf } from "./lines";
import { App } from "../src/components/App";
import { codingTask, hold as openHold } from "./stub-server";
import { createNotifier, teammateAttention, titleFor, useNotifyToggle } from "../src/lib/attention";
import { ENDING_SHOWN_MS, freshEndings, needsOf, statusOf, type StatusInputs } from "../src/lib/status";
import { scriptedServer, ScriptedProvider } from "./scripted-server";

const NOW = 1_000_000_000;
const coder = (id: string) => id === "cursor";
const named = (id: string) => id;
/** A coding board row, running on `cursor` unless `over` says otherwise. */
const task = (id: string, over: Partial<CodingBoardTask>): CodingBoardTask => codingTask({ id, assignee: "cursor", title: `Task ${id}`, goal: "g", status: "in_progress", ...over });
const approval = (resolution?: string) => linesOf([approvalItem("ap", "q", "s", "Publish the draft?"), ...(resolution ? [answered("ar", "q", "s", resolution)] : [])])[0]!;
const inputs = (over: Partial<StatusInputs>): StatusInputs => ({ activity: { running: false, lastActiveAt: 0 } as StatusInputs["activity"], lines: [], talk: [], tasks: [], now: NOW, ...over });
const status = (over: Partial<StatusInputs>) => statusOf("writer", inputs(over), named, coder);

describe("the status line puts what needs you first", () => {
  it("an approval you haven't answered, even while the teammate is answering", () => {
    expect(status({ lines: [approval()], activity: { running: true, lastActiveAt: NOW } as StatusInputs["activity"] })).toEqual({ text: "Needs your OK: Publish the draft?", tone: "text-attention", needsYou: true });
    // Answered, it needs nothing.
    expect(status({ lines: [approval("approved")] }).needsYou).toBe(false);
  });

  it("a task that waits on you, above the same task running", () => {
    const asks = task("t1", { asks: [openHold("question", "Which branch?")] });
    expect(status({ tasks: [asks] })).toEqual({ text: "Waiting on you: Which branch?", tone: "text-attention", needsYou: true });
    expect(status({ tasks: [task("t1", {})] }).text).toBe("Running coding task: Task t1");
  });

  it("several running tasks: the newest names the line, so a task left running for days can't hide the one you just started", () => {
    const stale = task("old", { title: "Clarify search guidance", startedAt: NOW - 72 * 3_600_000 });
    const fresh = task("new", { title: "Add day dividers", startedAt: NOW - 60_000 });
    // Either order on the board: the line still names the newest.
    expect(status({ tasks: [stale, fresh] }).text).toBe("Running 2 tasks · Add day dividers");
    expect(status({ tasks: [fresh, stale] }).text).toBe("Running 2 tasks · Add day dividers");
    // A task with no start yet (queued, never run) ranks oldest: one that has started is what is happening now.
    const unstarted = task("queued", { title: "Queued work", startedAt: undefined, run: undefined });
    expect(status({ tasks: [unstarted, fresh] }).text).toBe("Running 2 tasks · Add day dividers");
  });

  it("doesn't count a task waiting on its pull request as running: three PRs open is idle, not 'Running 3 tasks'", () => {
    const open = (id: string) => task(id, { pullRequests: [Number(id.slice(2))], startedAt: NOW - 3_600_000 });
    expect(status({ tasks: [open("pr5451"), open("pr5452"), open("pr5512")] }).text).not.toMatch(/^Running/);
    expect(status({ tasks: [open("pr5451"), task("new", { title: "Add day dividers", startedAt: NOW - 60_000 })] }).text).toBe("Running coding task: Add day dividers");
  });

  it("still reports a task that was idle on its pull request when the merge completes it", () => {
    const idle = task("pr", { title: "Add day dividers", pullRequests: [5512], startedAt: NOW - 3_600_000 });
    expect(freshEndings([idle], NOW, coder)).toEqual([]);
    const merged = { ...idle, status: "completed" as const, pullRequests: [], completedAt: NOW - 30_000 };
    expect(freshEndings([merged], NOW, coder)).toEqual([merged]);
    expect(status({ tasks: [merged] }).text).toBe("Coding task finished: Add day dividers");
  });

  it("a coding task that just ended, for two minutes, a failure in red", () => {
    const failed = task("t2", { status: "errored", completedAt: NOW - 30_000 });
    expect(status({ tasks: [failed] })).toEqual({ text: "Coding task failed: Task t2", tone: "text-destructive", needsYou: false });
    expect(status({ tasks: [task("t3", { status: "completed", completedAt: NOW - 1_000 })] })).toEqual({ text: "Coding task finished: Task t3", tone: "text-muted-foreground", needsYou: false });
    expect(status({ tasks: [task("t3", { status: "completed", completedAt: NOW - ENDING_SHOWN_MS })] }).text).toBe("Idle");
    // A teammate's job isn't a coding task, and a withdrawn task doesn't flash.
    expect(status({ tasks: [task("t4", { assignee: "researcher", status: "completed", completedAt: NOW })] }).text).toBe("Idle");
    expect(status({ tasks: [task("t5", { status: "cancelled", completedAt: NOW })] }).text).toBe("Idle");
  });
});

describe("the tab's title", () => {
  it("counts the teammates that have something for you, each once", () => {
    expect(titleFor({})).toBe("Teammates");
    expect(titleFor({ a: { asks: true, loaded: true, alerts: [{ key: "1", text: "" }, { key: "2", text: "" }] }, b: { asks: false, loaded: true, alerts: [{ key: "3", text: "" }] }, c: { asks: true, loaded: true, alerts: [] } })).toBe("(2) Teammates");
  });

  it("counts a teammate with only unread lines, though it needs nothing and notifies nothing", () => {
    // D3: the title counts unread or needing you; the badge and notifications are needs only.
    const unreadOnly = teammateAttention("writer", true, 2, [], []);
    expect(unreadOnly).toEqual({ asks: true, loaded: true, alerts: [] });
    expect(titleFor({ writer: unreadOnly, researcher: teammateAttention("researcher", true, 0, [], []) })).toBe("(1) Teammates");
  });
});

describe("Notify me", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });
  const stub = (answer: string) => vi.stubGlobal("Notification", Object.assign(function () {}, { permission: "default", requestPermission: async () => answer }));

  it("a refused permission leaves it off, remembers nothing, and says why", async () => {
    stub("denied");
    const { result } = renderHook(() => useNotifyToggle());
    await act(() => result.current.toggle());
    expect(result.current.on).toBe(false);
    expect(result.current.blocked).toBe("Notifications are blocked for this page in the browser's settings.");
    expect(window.localStorage.getItem("teammates.notify")).toBeNull();
  });

  it("a granted permission turns it on and remembers it", async () => {
    stub("granted");
    const { result } = renderHook(() => useNotifyToggle());
    await act(() => result.current.toggle());
    expect(result.current.on).toBe(true);
    expect(result.current.blocked).toBeUndefined();
    expect(window.localStorage.getItem("teammates.notify")).toBe("on");
  });
});

describe("the notifier", () => {
  /** One loaded teammate holding these alerts. */
  const row = (...keys: string[]) => ({ writer: { asks: true, loaded: true, alerts: keys.map((key) => ({ key, text: key })) } });

  it("fires once per new alert, only while on and with the tab hidden", () => {
    const sent: string[] = [];
    let on = false;
    let hidden = false;
    const observe = createNotifier({ enabled: () => on, hidden: () => hidden, notify: (text) => sent.push(text) });
    observe(row());
    observe(row("seen in front"));
    on = true;
    observe(row("seen in front", "new, tab in front"));
    hidden = true;
    observe(row("seen in front", "new, tab hidden"));
    observe(row("new, tab hidden"));
    on = false;
    observe(row("while off"));
    expect(sent).toEqual(["new, tab hidden"]);
  });

  it("never fires for what each teammate already held when the page loaded, though the tab loads hidden", () => {
    const sent: string[] = [];
    const observe = createNotifier({ enabled: () => true, hidden: () => true, notify: (text) => sent.push(text) });
    // Rows report before their watches load, then load one by one.
    observe({ writer: { asks: false, loaded: false, alerts: [] }, researcher: { asks: false, loaded: false, alerts: [] } });
    observe({ writer: { asks: true, loaded: true, alerts: [{ key: "old-w", text: "old-w" }] }, researcher: { asks: false, loaded: false, alerts: [] } });
    observe({ writer: { asks: true, loaded: true, alerts: [{ key: "old-w", text: "old-w" }] }, researcher: { asks: true, loaded: true, alerts: [{ key: "old-r", text: "old-r" }] } });
    expect(sent).toEqual([]);
    // What arrives after a teammate loaded is new.
    observe({ writer: { asks: true, loaded: true, alerts: [{ key: "old-w", text: "old-w" }, { key: "new-w", text: "new-w" }] }, researcher: { asks: true, loaded: true, alerts: [{ key: "old-r", text: "old-r" }] } });
    expect(sent).toEqual(["new-w"]);
  });

  it("a task's second hold on you is a new need, not the first one again", () => {
    const hold = (holdId: string) => task("t1", { asks: [openHold("question", "Which branch?", { id: holdId })] });
    const keys = (t: CodingBoardTask) => needsOf({ lines: [], tasks: [t] }).map((n) => n.key);
    expect(keys(hold("h1"))).not.toEqual(keys(hold("h2")));
  });
});

describe("a teammate waiting on your yes, on screen", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "visibilityState");
  });

  const workers = () => screen.getByRole("navigation", { name: "Workers" });
  const row = (name: string) => workers().querySelector<HTMLElement>(`[data-worker="${name}"]`)!;

  it("badges its row, leads its line, counts in the tab's title, and notifies a hidden tab", async () => {
    const sent: string[] = [];
    const Fake = Object.assign(
      function (this: unknown, _title: string, options: { body: string }) {
        sent.push(options.body);
      },
      { permission: "granted", requestPermission: async () => "granted" },
    );
    vi.stubGlobal("Notification", Fake);
    render(<ScriptedProvider server={scriptedServer({ speed: 0.05 })}><App /></ScriptedProvider>);
    await waitFor(() => expect(row("writer")).toBeTruthy());
    await act(async () => fireEvent.click(within(workers()).getByRole("switch", { name: "Notify me when tasks finish" })));
    expect(within(workers()).getByRole("switch", { name: "Notify me when tasks finish" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row("writer"));
    // The tab goes to the background before the question arrives.
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    const box = await screen.findByLabelText("Message writer");
    await act(async () => {
      fireEvent.change(box, { target: { value: "Publish the draft." } });
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(row("writer").querySelector("[data-status]")?.textContent).toBe("Needs your OK: Publish the draft to the team page?"));
    expect(row("writer").querySelector("[data-needs-you]")).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("(1) Teammates"));
    expect(sent).toEqual(["writer needs your OK: Publish the draft to the team page?"]);

    const card = await screen.findByRole("region", { name: "writer asks" });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Approve" })));
    await waitFor(() => expect(row("writer").querySelector("[data-needs-you]")).toBeNull());
    await waitFor(() => expect(document.title).toBe("Teammates"));
  });

  it("with Notify me off, points at the switch while something waits on you, and stops once it is answered", async () => {
    // A wait nobody hears about sits for minutes: the switch must be findable exactly then.
    vi.stubGlobal("Notification", Object.assign(function () {}, { permission: "default", requestPermission: async () => "granted" }));
    render(<ScriptedProvider server={scriptedServer({ speed: 0.05 })}><App /></ScriptedProvider>);
    await waitFor(() => expect(row("writer")).toBeTruthy());
    expect(workers().querySelector("[data-notify-nudge]")).toBeNull();
    fireEvent.click(row("writer"));
    const box = await screen.findByLabelText("Message writer");
    await act(async () => {
      fireEvent.change(box, { target: { value: "Publish the draft." } });
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(row("writer").querySelector("[data-needs-you]")).toBeTruthy());
    await waitFor(() => expect(workers().querySelector("[data-notify-nudge]")).toBeTruthy());
    const card = await screen.findByRole("region", { name: "writer asks" });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Approve" })));
    await waitFor(() => expect(workers().querySelector("[data-notify-nudge]")).toBeNull());
  });
});
