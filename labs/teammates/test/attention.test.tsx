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
import { taskView } from "@flow-state-dev/orchestration/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardTask, ConversationEntry } from "../src/adapter";
import { App } from "../src/App";
import { createNotifier, teammateAttention, titleFor, useNotifyToggle } from "../src/lib/attention";
import { ENDING_SHOWN_MS, needsOf, statusOf, type StatusInputs } from "../src/lib/status";
import { createFixtureLab } from "./fake-lab";

const NOW = 1_000_000_000;
const coder = (id: string) => id === "cursor";
const named = (id: string) => id;
/** A task, with its row's view carrying when it ended (`completedAt`), as the adapter reads one. */
const task = (id: string, { completedAt, ...over }: Partial<BoardTask> & { completedAt?: number }): BoardTask => {
  const t: BoardTask = { id, to: "cursor", title: `Task ${id}`, status: "running", boardStatus: "in_progress", goal: "g", ...over };
  return { ...t, view: taskView({ id, status: t.boardStatus, title: t.title, goal: t.goal, board: "s1", completedAt }) };
};
const approval = (resolution?: string): ConversationEntry => ({ kind: "approval", id: "ap", requestId: "q", suspensionId: "s", text: "Publish the draft?", ...(resolution ? { resolution } : {}) });
const inputs = (over: Partial<StatusInputs>): StatusInputs => ({ activity: { running: false, lastActiveAt: 0 } as StatusInputs["activity"], entries: [], talk: [], tasks: [], now: NOW, ...over });
const status = (over: Partial<StatusInputs>) => statusOf("writer", inputs(over), named, coder);

describe("the status line puts what needs you first", () => {
  it("an approval you haven't answered, even while the teammate is answering", () => {
    expect(status({ entries: [approval()], activity: { running: true, lastActiveAt: NOW } as StatusInputs["activity"] })).toEqual({ text: "Needs your OK: Publish the draft?", tone: "text-attention", needsYou: true });
    // Answered, it needs nothing.
    expect(status({ entries: [approval("approved")] }).needsYou).toBe(false);
  });

  it("a task that waits on you, above the same task running", () => {
    const asks = task("t1", { waiting: { kind: "question", prompt: "Which branch?", unanswerable: null } });
    expect(status({ tasks: [asks] })).toEqual({ text: "Waiting on you: Which branch?", tone: "text-attention", needsYou: true });
    expect(status({ tasks: [task("t1", {})] }).text).toBe("Running coding task: Task t1");
  });

  it("a coding task that just ended, for two minutes, a failure in red", () => {
    const failed = task("t2", { status: "failed", completedAt: NOW - 30_000 });
    expect(status({ tasks: [failed] })).toEqual({ text: "Coding task failed: Task t2", tone: "text-destructive", needsYou: false });
    expect(status({ tasks: [task("t3", { status: "done", completedAt: NOW - 1_000 })] })).toEqual({ text: "Coding task finished: Task t3", tone: "text-muted-foreground", needsYou: false });
    expect(status({ tasks: [task("t3", { status: "done", completedAt: NOW - ENDING_SHOWN_MS })] }).text).toBe("Idle");
    // A teammate's job isn't a coding task, and a withdrawn task doesn't flash.
    expect(status({ tasks: [task("t4", { to: "researcher", status: "done", completedAt: NOW })] }).text).toBe("Idle");
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
    const hold = (holdId: string) => task("t1", { waiting: { kind: "question", prompt: "Which branch?", unanswerable: null, holdId } });
    const keys = (t: BoardTask) => needsOf({ entries: [], tasks: [t] }).map((n) => n.key);
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
    render(<App adapter={createFixtureLab({ speed: 0.05 })} />);
    await waitFor(() => expect(row("writer")).toBeTruthy());
    await act(async () => fireEvent.click(within(workers()).getByRole("checkbox", { name: "Notify me" })));
    expect((within(workers()).getByRole("checkbox", { name: "Notify me" }) as HTMLInputElement).checked).toBe(true);
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
});
