// @vitest-environment happy-dom
/**
 * A teammate's panel is three tabs, *Tasks*, *Routines* and *Pull Requests*,
 * each with its count, the last one picked kept per teammate. A tab you are not
 * on shows a dot when something in it waits on you. *Pull Requests* lists the
 * pull requests the runs of this conversation's tasks recorded, open ones
 * first, each linked and naming the task that opened it.
 *
 * Red before this: the panel stacked *Tasks* over *Routines* with no tabs and
 * listed no pull requests anywhere.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rosterEntry } from "./scripted-server";
import { codingTask, hold, POPUP_READ, stubServer, TestProvider, type StubData } from "./stub-server";
import { TeammatePanel } from "../src/components/TeammatePanel";
import type { Popup } from "../src/components/Popups";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const NOW = Date.now();
const MIN = 60_000;

const coding = (id: string, over: Partial<CodingBoardTask>, completedAt?: number): CodingBoardTask =>
  codingTask({ id, assignee: "teammates.cursor", harness: "cursor", title: `Task ${id}`, status: "in_progress", startedAt: NOW - 10 * MIN, ...(completedAt === undefined ? {} : { completedAt }), ...over });

const TASKS: CodingBoardTask[] = [
  coding("t-open", { run: { sessionId: "run-a", requestId: "q-a", attempt: 1 }, pullRequests: [7] }),
  coding("t-asks", { run: { sessionId: "run-b", requestId: "q-b", attempt: 1 }, asks: [hold("review", "Review the work", { taskId: "t-asks" })] }),
  coding("t-merged", { status: "completed", run: { sessionId: "run-c", requestId: "q-c", attempt: 1 } }, NOW - 5 * MIN),
  coding("t-none", { status: "completed" }, NOW - 50 * MIN),
];

const RECORDED: StubData["recorded"] = {
  "run-a": { pullRequests: [{ number: 7, url: "https://github.com/o/r/pull/7", title: "Add a welcome line", state: "open" }] },
  "run-b": { pullRequests: [{ number: 9, url: "https://github.com/o/r/pull/9", title: "Fix the footer", state: "draft" }] },
  "run-c": { pullRequests: [{ number: 5, url: "https://github.com/o/r/pull/5", title: "Bump the deps", state: "merged" }] },
};

const ROUTINES = [
  { id: "clock:daily", name: "daily", worker: "chief", paused: false, trigger: { clock: { cron: "0 9 * * *", timezone: "UTC", nextRunAt: null } } },
];

function renderPanel(data: StubData = { board: { s1: TASKS }, recorded: RECORDED, routines: ROUTINES }, onOpen: (popup: Popup) => void = () => {}, workerId = "chief") {
  const { client } = stubServer(data);
  return render(
    <TestProvider client={client}>
      <TeammatePanel worker={rosterEntry({ id: workerId, name: "Lead", description: "Routes work" })} sessionId="s1" openTask={undefined} nameOf={(id) => id} isCoding={() => true} onOpen={onOpen} />
    </TestProvider>,
  );
}

const panelTabs = () => within(screen.getByRole("tablist", { name: "Panel" }));
const top = (name: string) => panelTabs().getByRole("tab", { name: new RegExp(`^${name}`) });

describe("a teammate's panel tabs", () => {
  it("draws Tasks, Routines and Pull Requests, each with its count (Pull Requests counts the open ones), Tasks selected first", async () => {
    renderPanel();
    await waitFor(() => expect(top("Pull Requests").textContent).toMatch(/2$/), POPUP_READ);
    expect(panelTabs().getAllByRole("tab").map((t) => [t.textContent?.replace(/\s+/g, ""), t.getAttribute("aria-selected")])).toEqual([
      ["Tasks4", "true"],
      ["Routines1", "false"],
      ["PullRequests2", "false"],
    ]);
    // The status filter is still there, a second, different tab list inside Tasks.
    expect(screen.getByRole("tablist", { name: "Task status" })).toBeTruthy();
  });

  it("shows each tab's own content, and moves between them with the arrow keys", async () => {
    renderPanel();
    await screen.findByRole("list", { name: "Running" }, POPUP_READ);
    fireEvent.click(top("Routines"));
    expect(await screen.findByRole("list", { name: "Lead's routines" })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Task status" })).toBeNull();
    fireEvent.keyDown(top("Routines"), { key: "ArrowRight" });
    expect(top("Pull Requests").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(top("Pull Requests"));
    expect(await screen.findByRole("list", { name: "Open pull requests" }, POPUP_READ)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Lead's routines" })).toBeNull();
    fireEvent.keyDown(top("Pull Requests"), { key: "ArrowRight" });
    expect(top("Tasks").getAttribute("aria-selected")).toBe("true");
  });

  it("marks a tab you are not on when something in it waits on you, and not the one you are on", async () => {
    renderPanel();
    await screen.findByRole("list", { name: "Running" }, POPUP_READ);
    // On Tasks: its own dot is not drawn, the task waiting on you is in front of you.
    expect(top("Tasks").querySelector("[data-attention]")).toBeNull();
    fireEvent.click(top("Routines"));
    expect(top("Tasks").querySelector("[data-attention]")).not.toBeNull();
    // Its pull request's task waits on you too, so Pull Requests says so.
    await waitFor(() => expect(top("Pull Requests").querySelector("[data-attention]")).not.toBeNull(), POPUP_READ);
    expect(top("Routines").querySelector("[data-attention]")).toBeNull();
  });

  it("draws no dot for a panel with nothing waiting on you", async () => {
    // Its one task is idle on its open pull request: nothing for you.
    renderPanel({ board: { s1: [TASKS[0]!] }, recorded: RECORDED, routines: [] });
    await waitFor(() => expect(top("Tasks").textContent).toMatch(/1$/), POPUP_READ);
    fireEvent.click(top("Routines"));
    await waitFor(() => expect(top("Pull Requests").textContent).toMatch(/1$/), POPUP_READ);
    expect(top("Tasks").querySelector("[data-attention]")).toBeNull();
    expect(top("Pull Requests").querySelector("[data-attention]")).toBeNull();
  });

  it("lists the pull requests its tasks' runs recorded, open first, each linked, with its state and its task", async () => {
    const onOpen = vi.fn();
    renderPanel(undefined, onOpen);
    fireEvent.click(top("Pull Requests"));
    const open = await screen.findByRole("list", { name: "Open pull requests" }, POPUP_READ);
    const closed = screen.getByRole("list", { name: "Merged or closed pull requests" });
    const items = (list: HTMLElement) => within(list).getAllByRole("listitem");
    expect(items(open).map((li) => li.getAttribute("data-pull-request"))).toEqual(["9", "7"]);
    expect(items(closed).map((li) => li.getAttribute("data-pull-request"))).toEqual(["5"]);
    const link = within(items(open)[1]!).getByRole("link", { name: /#7 Add a welcome line/ });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/7");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(items(open)[0]!.querySelector("[data-pr-state]")?.textContent).toBe("draft");
    expect(items(open)[1]!.querySelector("[data-pr-state]")?.textContent).toBe("open");
    expect(items(closed)[0]!.querySelector("[data-pr-state]")?.textContent).toBe("merged");
    // The one whose task waits on you says so.
    expect(within(items(open)[0]!).getByText("waiting on you")).toBeTruthy();
    fireEvent.click(within(items(open)[1]!).getByRole("button", { name: "Task t-open" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "task", sessionId: "s1", taskId: "t-open" });
  });

  it("says so when its tasks have opened no pull request", async () => {
    renderPanel({ board: { s1: [TASKS[3]!] }, recorded: {}, routines: [] });
    fireEvent.click(top("Pull Requests"));
    expect(await screen.findByText("No pull requests yet.")).toBeTruthy();
    expect(top("Pull Requests").textContent).toMatch(/0$/);
  });

  it("remembers the tab picked, per teammate", async () => {
    const first = renderPanel();
    fireEvent.click(top("Routines"));
    first.unmount();
    renderPanel();
    expect(top("Routines").getAttribute("aria-selected")).toBe("true");
    cleanup();
    renderPanel(undefined, undefined, "researcher");
    expect(top("Tasks").getAttribute("aria-selected")).toBe("true");
  });
});
