// @vitest-environment happy-dom
/**
 * When the Lab goes away after Shift Manager has read it (FIX-2373 D2).
 *
 * Swapping the shell for the couldn't-reach page on a later refresh throws
 * away the route, the open task and anything typed, for a failure the next
 * read usually fixes. So once a read has landed, a failed refresh keeps the
 * last good snapshot on screen, says the server is gone in a bar above the
 * shell, greys the statuses drawn from it and stops their clocks, and reads
 * again on its own until one lands. The full-screen page stays for a first
 * read, before there is anything to keep.
 *
 * The bar reads one state for the page: the worst of the snapshot read's and
 * the session feeds on screen, so a conversation whose stream has lapsed says
 * so even while the snapshot reads fine.
 *
 * The reader is swapped for one the test answers, as the roster tests do.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { useReportFeedState, worstFeedState } from "../src/lib/feed-health";
import { LabProvider, useLab } from "../src/lib/lab-data";
import { inboxSection, toBoardTaskView, toWorker, type LabSnapshot } from "../src/lib/reads";
import type { LoadedSnapshot } from "../src/lib/derive";
import type { ConnectionFeedStatus } from "../src/components/flow-state/connection-banner";

/** What the next read answers. */
let answer: () => LabSnapshot;
let reads = 0;

// One object, as the provider hands one: a new one each render re-reads the roster on every render.
const workforce = {
  roster: async () => [],
  // The roster watch, reporting one read.
  watchRoster: (onRoster: (entries: never[]) => void, options?: { onError?: (error: unknown) => void }) => (void Promise.resolve([] as never[]).then(onRoster, options?.onError), () => {}),
};
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));
vi.mock("../src/lib/reads", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/reads")>();
  return {
    ...real,
    createLabReader: () => ({
      read: async () => {
        reads += 1;
        return answer();
      },
      readBoard: async () => [],
      resume: async () => {},
    }),
  };
});

const STALE = "opacity-60";
const startedAt = Date.UTC(2026, 10, 4, 9, 0);

/** One running task on eng's board, and ops' board failing, so Tasks offers a Retry that reads again. */
function lab(): LabSnapshot {
  const workers = [toWorker({ id: "eng.coder", kind: "coder" })!];
  const running = toBoardTaskView("s_eng.tasks", "s_eng", "E-1", { id: "E-1", title: "E-1 title", status: "in_progress", assignee: "coder", startedAt });
  const read: Omit<LoadedSnapshot, "inbox"> = {
    readAt: startedAt,
    sessions: [],
    orgId: "acme",
    inventory: { ok: true, value: { workers } },
    boards: {
      s_eng: { ok: true, value: { refs: [running.boardRef], rows: [running] } },
      s_ops: { ok: false, failure: { message: "board offline" } },
    },
    asks: { ok: true, value: [] },
    resources: { ok: true, value: [] },
    projects: { ok: true, value: { rows: [] } },
  };
  return { ...read, inbox: inboxSection(read.asks, read.boards, read.sessions) };
}
const down = (): LabSnapshot => ({ unreachable: { httpStatus: 503, message: "store offline" } });

beforeEach(() => {
  answer = lab;
  reads = 0;
  (window as unknown as { happyDOM: { setViewport(viewport: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 1600, height: 900 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function openTasks() {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://lab.local/tasks");
  render(<App connection={{ userId: "u_test" }} />);
  await screen.findByTestId("tasks");
}
/** Tasks' Retry on ops' failing board: the one refresh this screen can ask for. */
const retryBoards = () => act(async () => void fireEvent.click(within(screen.getByTestId("tasks")).getByText("Retry")));
const sleep = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("a refresh that can't reach the Lab after a good read", () => {
  it("keeps the shell, the route and a typed draft, shows the bar, and a good read clears it", async () => {
    await openTasks();
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    // Something typed: Jump to's query, held by the shell.
    act(() => void fireEvent.keyDown(window, { key: "k", metaKey: true }));
    const query = (await screen.findByTestId("jump-input")) as HTMLInputElement;
    fireEvent.change(query, { target: { value: "E-1 half typed" } });

    answer = down;
    await retryBoards();
    expect(screen.getByTestId("connection-banner").textContent).toContain("Lost the server");
    expect(screen.queryByTestId("unreachable")).toBeNull();
    expect(screen.getByTestId("shell")).toBeTruthy();
    expect(screen.getByTestId("centre").getAttribute("data-level")).toBe("tasks");
    expect((screen.getByTestId("jump-input") as HTMLInputElement).value).toBe("E-1 half typed");
    expect(screen.getByTestId("task-row-title").textContent).toBe("E-1 title");

    answer = lab;
    await retryBoards();
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("greys the task's status and stops its clock while the bar is up, and starts it again after", async () => {
    // Only the date is faked: the page's own clocks tick on real timers and read it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(startedAt + 60_000);
    await openTasks();
    const time = () => screen.getByTestId("task-row-time");
    expect(time().textContent).toBe("1m 00s");
    expect(screen.getByTestId("task-row-status").className).not.toContain(STALE);

    answer = down;
    await retryBoards();
    expect(time().className).toContain(STALE);
    expect(screen.getByTestId("task-row-status").className).toContain(STALE);
    vi.setSystemTime(startedAt + 10 * 60_000);
    await sleep(1_200);
    expect(time().textContent).toBe("1m 00s");

    answer = lab;
    await retryBoards();
    await sleep(1_200);
    expect(time().className).not.toContain(STALE);
    expect(time().textContent).toBe("10m");
  });

  it("reads again on its own on the client's backoff, 1s after a failure and then 2s after the next, without a click", async () => {
    await openTasks();
    answer = down;
    const before = reads;
    await retryBoards();
    // The click's read fails, and the live read takes the failure over: it reads at once, which fails too.
    await waitFor(() => expect(reads).toBe(before + 2));
    const after = reads;
    await sleep(700);
    expect(reads).toBe(after);
    await waitFor(() => expect(reads).toBe(after + 1), { timeout: 800 });
    answer = lab;
    await sleep(1_500);
    expect(reads).toBe(after + 1);
    await waitFor(() => expect(screen.queryByTestId("connection-banner")).toBeNull(), { timeout: 1_500 });
    expect(reads).toBe(after + 2);
    // Back: nothing reads again on its own.
    await sleep(2_500);
    expect(reads).toBe(after + 2);
  }, 15_000);

  it("a first read that fails still gets the full-screen page, which reads again on its own", async () => {
    answer = down;
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://lab.local/tasks");
    render(<App connection={{ userId: "u_test" }} />);
    expect((await screen.findByTestId("unreachable-message")).textContent).toBe("503 · store offline");
    expect(screen.queryByTestId("shell")).toBeNull();
    answer = lab;
    await screen.findByTestId("tasks", undefined, { timeout: 3_000 });
  });
});

describe("the page's connection is the worst of its feeds", () => {
  it("orders stopped › lapsed › the rest", () => {
    expect(worstFeedState(["live", "lapsed", "reconnecting"])).toBe("lapsed");
    expect(worstFeedState(["lapsed", "stopped", "live"])).toBe("stopped");
    expect(worstFeedState(["live", "reconnecting"])).toBe("reconnecting");
    expect(worstFeedState([])).toBe("live");
  });

  it("a feed on screen that lapses makes the page stale while the snapshot reads fine, and stops counting once it goes", async () => {
    // One object, as the page holds one: a new connection is a new client and a new read.
    const CONNECTION = { userId: "u_test" };
    let seen: { health: ConnectionFeedStatus; stale: boolean } | undefined;
    function Feed({ state }: { state: ConnectionFeedStatus }) {
      useReportFeedState(state);
      return null;
    }
    function Probe({ feed }: { feed: ConnectionFeedStatus | null }) {
      const { health, stale } = useLab();
      seen = { health, stale };
      return feed === null ? null : <Feed state={feed} />;
    }
    const { rerender } = render(
      <LabProvider connection={CONNECTION}>
        <Probe feed="live" />
      </LabProvider>,
    );
    await waitFor(() => expect(seen!.health).toBe("live"));
    rerender(
      <LabProvider connection={CONNECTION}>
        <Probe feed="reconnecting" />
      </LabProvider>,
    );
    expect(seen).toEqual({ health: "reconnecting", stale: false });
    rerender(
      <LabProvider connection={CONNECTION}>
        <Probe feed="lapsed" />
      </LabProvider>,
    );
    expect(seen).toEqual({ health: "lapsed", stale: true });
    rerender(
      <LabProvider connection={CONNECTION}>
        <Probe feed={null} />
      </LabProvider>,
    );
    expect(seen).toEqual({ health: "live", stale: false });
  });
});
