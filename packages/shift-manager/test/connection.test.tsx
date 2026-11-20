// @vitest-environment happy-dom
/**
 * When the Lab goes away after Shift Manager has read it (FIX-2373 D2).
 *
 * Swapping the shell for the couldn't-reach page on a later refresh throws
 * away the route, the open task and anything typed, for a failure the next
 * read usually fixes. So once in, a read that lapses (R reading the Inbox view
 * again, here) keeps the last good answer on screen, says the server is gone
 * in a bar above the shell, greys the statuses drawn from it and stops their
 * clocks. The full-screen page stays for the organization read, before there
 * is anything to keep (`lib/gate.ts`).
 *
 * The bar reads one state for the page: the worst of the reads and session
 * feeds on screen, so a conversation whose stream has lapsed says so even
 * while the rest reads fine. The Inbox view is one of them on every page, so
 * its first read failing, or being refused, shows on the bar too: the frame is
 * already drawn, and nothing else would say the Lab is gone.
 *
 * The views are read through a stand-in `useView` the test answers: the real
 * `useInbox` reports the Inbox view's state to the bar, as it does over the Lab.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientHttpError } from "@flow-state-dev/client";
import { boardTaskOf } from "@flow-state-dev/workforce/browser";
import { App } from "../src/App";
import { useReportFeedState, worstFeedState } from "../src/lib/feed-health";
import { LabProvider, useLab } from "../src/lib/lab-data";
import { useInbox, type InboxViewValue } from "../src/lib/inbox";
import { toWorker } from "../src/lib/workers";
import type { ConnectionFeedStatus } from "../src/components/flow-state/connection-banner";
import type { DirectoryFixture } from "./helpers/directory";
import { inboxViewOf } from "./helpers/inbox-view";

/** What the organization read answers: the gate's read. */
let organization: () => Promise<string>;
let organizationReads = 0;
/** The Inbox view's answer: one good read, as one landed. */
let view: InboxViewValue;
/** Why the Inbox view's reads fail now, as the server answered; `undefined` while they land. */
let viewFailure: { message: string; httpStatus?: number } | undefined;
/** Whether a read of the Inbox view has landed yet: a first read that fails has no answer to keep. */
let viewLanded = true;
/** The Inbox view's first read is still running: no answer and no failure yet. */
let viewPending = false;
/** The directory the page draws: one good read, as one landed. */
let directory: DirectoryFixture;

// One object, as the provider hands one: a new one each render re-reads the roster on every render.
const workforce = {
  organization: () => {
    organizationReads += 1;
    return organization();
  },
  roster: async () => [],
  // The roster watch, reporting one read.
  watchRoster: (onRoster: (entries: never[]) => void, options?: { onError?: (error: unknown) => void }) => (void Promise.resolve([] as never[]).then(onRoster, options?.onError), () => {}),
};
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));
// The views, as `useView` hands them over: the Inbox view's answer, its staleness and why its latest read
// failed; R and Retry read it again (a redraw, here). Every other view on these pages has no answer yet.
vi.mock("@flow-state-dev/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@flow-state-dev/react")>();
  const { inboxViewRef } = await import("@flow-state-dev/workforce/browser");
  const { useReducer } = await import("react");
  return {
    ...real,
    useView: (ref: unknown, _input: unknown, options: { enabled?: boolean } = {}) => {
      const [, redraw] = useReducer((n: number) => n + 1, 0);
      if (ref !== inboxViewRef || options.enabled === false) return { value: undefined, stale: false, refresh: redraw };
      if (viewPending) return { value: undefined, stale: false, refresh: redraw };
      if (viewFailure === undefined) return { value: view, stale: false, refresh: redraw };
      return viewLanded ? { value: view, stale: true, failure: viewFailure, refresh: redraw } : { value: undefined, stale: false, failure: viewFailure, refresh: redraw };
    },
  };
});
vi.mock("../src/lib/directory-reads", async () => {
  const { useFixtureReads } = await import("./helpers/directory");
  return { useDirectoryReads: () => useFixtureReads(() => directory) };
});

const STALE = "opacity-60";
const startedAt = Date.UTC(2026, 10, 4, 9, 0);

/** One running task on eng's board. */
function lab(): { directory: DirectoryFixture; view: InboxViewValue } {
  const workers = [toWorker({ id: "eng.coder", kind: "coder" })!];
  const running = boardTaskOf("s_eng.tasks", "s_eng", "E-1", { id: "E-1", title: "E-1 title", status: "in_progress", assignee: "coder", startedAt });
  return { directory: { sessions: [], inventory: { ok: true, value: { workers } } }, view: inboxViewOf([running]) };
}

beforeEach(() => {
  organization = async () => "acme";
  organizationReads = 0;
  viewFailure = undefined;
  viewLanded = true;
  viewPending = false;
  ({ directory, view } = lab());
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
/** R, pressed outside any field: the page's reads read again, the Inbox view's among them. */
const retryBoards = () => act(async () => void fireEvent.keyDown(document.body, { key: "r" }));
const sleep = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
/** The Inbox view's reads fail from now on, as the server answers `httpStatus`. */
const viewDown = (httpStatus = 503) => void (viewFailure = { message: "store offline", httpStatus });

describe("a read that can't reach the Lab after a good one", () => {
  it("keeps the shell, the route and a typed draft, shows the bar, and a good read clears it", async () => {
    await openTasks();
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    // Something typed: Jump to's query, held by the shell.
    act(() => void fireEvent.keyDown(window, { key: "k", metaKey: true }));
    const query = (await screen.findByTestId("jump-input")) as HTMLInputElement;
    fireEvent.change(query, { target: { value: "E-1 half typed" } });

    viewDown();
    await retryBoards();
    expect(screen.getByTestId("connection-banner").textContent).toContain("Lost the server");
    expect(screen.queryByTestId("unreachable")).toBeNull();
    expect(screen.getByTestId("shell")).toBeTruthy();
    expect(screen.getByTestId("centre").getAttribute("data-level")).toBe("tasks");
    expect((screen.getByTestId("jump-input") as HTMLInputElement).value).toBe("E-1 half typed");
    expect(screen.getByTestId("task-row-title").textContent).toBe("E-1 title");

    viewFailure = undefined;
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

    viewDown();
    await retryBoards();
    expect(time().className).toContain(STALE);
    expect(screen.getByTestId("task-row-status").className).toContain(STALE);
    vi.setSystemTime(startedAt + 10 * 60_000);
    await sleep(1_200);
    expect(time().textContent).toBe("1m 00s");

    viewFailure = undefined;
    await retryBoards();
    await sleep(1_200);
    expect(time().className).not.toContain(STALE);
    expect(time().textContent).toBe("10m");
  });

  it("an organization read that can't reach the Lab gets the full-screen page, which reads again on its own", async () => {
    organization = async () => {
      throw new ClientHttpError("Service Unavailable", { status: 503, body: { error: "store offline" } });
    };
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://lab.local/tasks");
    render(<App connection={{ userId: "u_test" }} />);
    expect((await screen.findByTestId("unreachable-message")).textContent).toBe("503 · store offline");
    expect(screen.queryByTestId("shell")).toBeNull();
    organization = async () => "acme";
    await screen.findByTestId("tasks", undefined, { timeout: 3_000 });
    expect(organizationReads).toBe(2);
  });

  it("an organization read that never reached the Lab (no answer at all) gets the couldn't-reach page, never the refusal", async () => {
    organization = async () => {
      throw new TypeError("fetch failed");
    };
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://lab.local/tasks");
    render(<App connection={{ userId: "u_test" }} />);
    expect((await screen.findByTestId("unreachable-message")).textContent).toContain("fetch failed");
    expect(screen.queryByTestId("refusal")).toBeNull();
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it("an organization read the Lab refuses gets the refusal page in today's words, and nothing else is read", async () => {
    organization = async () => {
      throw new ClientHttpError("Forbidden", { status: 403, body: { error: "no verified organization" } });
    };
    render(<App connection={{ userId: "u_test" }} />);
    const refused = await screen.findByTestId("refusal");
    expect(refused.textContent).toContain("This Lab won't let Shift Manager in");
    expect(refused.textContent).toContain("403 · no verified organization");
    expect(refused.textContent).toContain("the request carried no verified organization");
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it("a Lab that serves no roster flow is refused, naming the organization read it couldn't make", async () => {
    organization = async () => {
      throw new ClientHttpError("Not Found", { status: 404, body: { error: 'Unknown flow "workforce-roster"' } });
    };
    render(<App connection={{ userId: "u_test" }} />);
    const refused = await screen.findByTestId("refusal");
    expect(refused.textContent).toContain("The Lab names no organization for u_test: it serves no roster flow to ask it under.");
    expect(refused.textContent).toContain("doesn't say which one you're in");
  });
});

describe("the page's connection is the worst of its feeds", () => {
  it("orders stopped › lapsed › the rest", () => {
    expect(worstFeedState(["live", "lapsed", "reconnecting"])).toBe("lapsed");
    expect(worstFeedState(["lapsed", "stopped", "live"])).toBe("stopped");
    expect(worstFeedState(["live", "reconnecting"])).toBe("reconnecting");
    expect(worstFeedState([])).toBe("live");
  });

  it("a feed on screen that lapses makes the page stale while the rest reads fine, and stops counting once it goes", async () => {
    // One object, as the page holds one: a new connection is a new client.
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

// The frame is drawn once the gate and the directory have landed, before the Inbox view answers. A first
// read of it that fails is the only sign on the page that the Lab is gone, so the bar says so.
describe("an Inbox whose first read fails", () => {
  it("shows the bar as lost when it couldn't reach the Lab, and clears it when a read lands", async () => {
    viewLanded = false;
    viewDown(503);
    await openTasks();
    expect((await screen.findByTestId("connection-banner")).getAttribute("data-state")).toBe("lapsed");
    expect(screen.getByTestId("connection-banner").textContent).toContain("Lost the server");
    viewFailure = undefined;
    viewLanded = true;
    await retryBoards();
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("shows the bar as stopped when the Lab refused it", async () => {
    viewLanded = false;
    viewDown(403);
    await openTasks();
    expect((await screen.findByTestId("connection-banner")).getAttribute("data-state")).toBe("stopped");
    expect(screen.getByTestId("connection-banner").textContent).toContain("The server stopped this feed");
  });

  it("shows no bar while the first read is still running", async () => {
    // The real `useInbox`, its first read held: it has no answer and no failure, so it tells the bar nothing.
    viewPending = true;
    let mounted = false;
    function Inbox() {
      useInbox();
      mounted = true;
      return null;
    }
    function Probe() {
      const { health } = useLab();
      return <p data-testid="health">{health}</p>;
    }
    render(
      <LabProvider connection={{ userId: "u_test" }}>
        <Inbox />
        <Probe />
      </LabProvider>,
    );
    await waitFor(() => expect(mounted).toBe(true));
    await sleep(50);
    expect(screen.getByTestId("health").textContent).toBe("live");
  });
});
