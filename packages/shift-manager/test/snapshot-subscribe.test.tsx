// @vitest-environment happy-dom
/**
 * The snapshot reads again on its own when another session changes what it
 * shows, and says how old it is (FIX-2409).
 *
 * One subscription in the provider, through its own client, on the user's and
 * the org's topics and each listed session but Shift Manager's own. Only the
 * notices that change what the snapshot reads start a read: never a streamed
 * item, never a resource the snapshot doesn't read, never Shift Manager's own
 * reading and usage sessions, or each read would start the next. The summary
 * says when it was last read (D1), and counts dim only while a read the user
 * asked for runs (D2).
 *
 * The client's `subscribe` and the reader are swapped for ones the test drives.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary, WireNotice, WireTopic } from "@flow-state-dev/client";
import { App } from "../src/App";
import { LabProvider, useLab } from "../src/lib/lab-data";
import { inboxSection, PROJECT_READER_FLOW, readerSessionId, type LabSnapshot } from "../src/lib/reads";
import type { LoadedSnapshot } from "../src/lib/derive";
import { heard, heardSessionIds, SNAPSHOT_POLL_MS } from "../src/lib/snapshot-subscribe";
import { clockTime } from "../src/lib/shell";

const USER = "u_test";

type Opened = { topics: readonly WireTopic[]; options: { pollIntervalMs?: number }; onChange: (notice: WireNotice | null) => void; closed: boolean };
const opened: Opened[] = [];
const subscribe = vi.fn((topics: readonly WireTopic[], options: { onChange: (notice: WireNotice | null) => void; pollIntervalMs?: number }) => {
  const entry: Opened = { topics, options: { pollIntervalMs: options.pollIntervalMs }, onChange: options.onChange, closed: false };
  opened.push(entry);
  return { close: () => void (entry.closed = true) };
});
/** The subscription open now. */
const live = () => opened.filter((o) => !o.closed);

vi.mock("../src/lib/connection", () => ({
  connect: (connection: { userId: string }) => ({ userId: connection.userId, subscribe }),
  readConnection: () => ({ userId: USER }),
}));
// An empty roster watch: reports one read and never subscribes, so `opened` holds only the snapshot's.
const workforce = {
  watchRoster: (onRoster: (entries: never[]) => void, options?: { onError?: (error: unknown) => void }) =>
    (void Promise.resolve([] as never[]).then(onRoster, options?.onError), () => {}),
};
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));

let sessions: SessionSummary[] = [];
let readAt = Date.UTC(2026, 10, 4, 14, 2);
let reads = 0;
/** A read the test holds open until it calls `land`. */
let held: { land: () => void } | undefined;
let holdNext = false;
vi.mock("../src/lib/reads", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/reads")>();
  return {
    ...real,
    createLabReader: () => ({
      read: async () => {
        reads += 1;
        if (holdNext) {
          holdNext = false;
          await new Promise<void>((resolve) => (held = { land: resolve }));
        }
        return snapshotOf();
      },
      readBoard: async () => [],
      resume: async () => {},
    }),
  };
});

const session = (id: string, flowKind = "desk", parentSessionId?: string): SessionSummary =>
  ({ id, flowKind, userId: USER, createdAt: 0, updatedAt: 0, ...(parentSessionId === undefined ? {} : { parentSessionId }) }) as SessionSummary;

function snapshotOf(): LabSnapshot {
  const read: Omit<LoadedSnapshot, "inbox"> = {
    readAt,
    sessions,
    orgId: "acme",
    inventory: { ok: true, value: { workers: [] } },
    boards: {},
    asks: { ok: true, value: [] },
    resources: { ok: true, value: [] },
    projects: { ok: true, value: { rows: [] } },
  };
  return { ...read, inbox: inboxSection(read.asks, read.boards, read.sessions) };
}

const notice = (topic: WireTopic, kind: WireNotice["kind"]): WireNotice => ({ topic, kind });
const hear = (n: WireNotice | null) => act(async () => live()[0]!.onChange(n));
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

beforeEach(() => {
  opened.length = 0;
  subscribe.mockClear();
  sessions = [session("conv-1"), session(readerSessionId(USER, "roster"), "roster"), session("usage-own-abc", "codex")];
  readAt = Date.UTC(2026, 10, 4, 14, 2);
  reads = 0;
  held = undefined;
  holdNext = false;
});
afterEach(() => cleanup());

describe("what the snapshot hears", () => {
  it("reads on a session's request or run, never on its streamed items", () => {
    const conv = { scope: "session", id: "conv-1" } as const;
    expect(heard(notice(conv, "request"))).toBe(true);
    expect(heard(notice(conv, "run"))).toBe(true);
    expect(heard(notice(conv, "items"))).toBe(false);
    expect(heard(notice(conv, "state"))).toBe(false);
    expect(heard(notice({ ...conv, resource: "tasks" }, "board"))).toBe(false);
  });

  it("reads on a resource in a collection the snapshot reads, and on no other under the user or the org", () => {
    const user = (resource?: string) => notice({ scope: "user", ...(resource === undefined ? {} : { resource }) }, "resource");
    const org = (resource: string) => notice({ scope: "org", resource }, "resource");
    // A task filed or moved, a private project, a hire, a standard worker.
    expect(heard(user("tasks/s%5Fconv%7Eab/task_1"))).toBe(true);
    expect(heard(user("projects/p1"))).toBe(true);
    expect(heard(user("workforce/workers/pm"))).toBe(true);
    expect(heard(user("workforce/standard-workers/eng.pm"))).toBe(true);
    // Usage's readings and the messages between workers: the snapshot reads neither.
    expect(heard(user("worker-usage/codex/2026-11"))).toBe(false);
    expect(heard(user("workforce/messages/m1"))).toBe(false);
    expect(heard(user("tasks__ids/t1"))).toBe(false);
    // A row whose path a notice can't name may be one the snapshot reads.
    expect(heard(user())).toBe(true);
    expect(heard(org("inventory/workers/eng.pm"))).toBe(true);
    expect(heard(org("projects/p1"))).toBe(true);
    expect(heard(org("licenses/l1"))).toBe(false);
    expect(heard(notice({ scope: "user" }, "state"))).toBe(false);
    expect(heard(notice({ scope: "org" }, "resync"))).toBe(true);
  });

  it("subscribes every listed session but Shift Manager's own, and leaves out a run whose parent it hears", () => {
    const listed = [
      session("conv-1"),
      session(readerSessionId(USER, "roster"), "roster"),
      session(readerSessionId(USER, "codex"), "codex"),
      session("usage-own-1a2b", "codex"),
      session("task-1", "doer", "conv-1"),
      session("sub-1", "doer", "task-1"),
      session("orphan-run", "doer", "not-listed"),
    ];
    // task-1's writes reach conv-1 as `run`. sub-1's reach only task-1, which is left out, so it is heard itself.
    expect(heardSessionIds(listed, USER)).toEqual(["conv-1", "orphan-run", "sub-1"]);
  });

  it("leaves out the roster session Schedules reads through, even when its id was generated", () => {
    // Workforce's client opens a roster session without an id; the project reader reuses it, and
    // Schedules runs an action on it after every read. Hearing it would make each read start the next.
    const listed = [session("conv-1"), session("roster-generated-7f3a", PROJECT_READER_FLOW)];
    expect(heardSessionIds(listed, USER)).toEqual(["conv-1"]);
  });
});

function Probe({ seen }: { seen: { asking?: boolean; refresh?: () => Promise<void> } }) {
  const lab = useLab();
  seen.asking = lab.asking;
  seen.refresh = lab.refresh;
  return null;
}

describe("the provider's subscription", () => {
  it("opens once the first read lands, on the user, the org and each heard session, with a 30 s fallback", async () => {
    render(
      <LabProvider connection={{ userId: USER }}>
        <Probe seen={{}} />
      </LabProvider>,
    );
    await waitFor(() => expect(live()).toHaveLength(1));
    expect(live()[0]!.topics).toEqual([{ scope: "user" }, { scope: "org" }, { scope: "session", id: "conv-1" }]);
    expect(live()[0]!.options.pollIntervalMs).toBe(SNAPSHOT_POLL_MS);
    expect(SNAPSHOT_POLL_MS).toBe(30_000);
  });

  it("reads on a heard notice, and not on an item, a resource it doesn't read, or nothing at all", async () => {
    render(
      <LabProvider connection={{ userId: USER }}>
        <Probe seen={{}} />
      </LabProvider>,
    );
    await waitFor(() => expect(live()).toHaveLength(1));
    await settle();
    const before = reads;
    await hear(notice({ scope: "session", id: "conv-1" }, "items"));
    await hear(notice({ scope: "user", resource: "worker-usage/codex" }, "resource"));
    await settle();
    expect(reads).toBe(before);
    await hear(notice({ scope: "session", id: "conv-1" }, "request"));
    await settle();
    expect(reads).toBe(before + 1);
    // A connect, a reconnect or a timer tick reads too.
    await hear(null);
    await settle();
    expect(reads).toBe(before + 2);
  });

  it("drops unheard notices before they coalesce, so two different ones waiting behind a read start no read", async () => {
    render(
      <LabProvider connection={{ userId: USER }}>
        <Probe seen={{}} />
      </LabProvider>,
    );
    await waitFor(() => expect(live()).toHaveLength(1));
    await settle();
    const before = reads;
    holdNext = true;
    await hear(notice({ scope: "session", id: "conv-1" }, "request"));
    await waitFor(() => expect(held).toBeDefined());
    // Two streams' items, different topics: merged, they would read as `null`.
    await hear(notice({ scope: "session", id: "conv-1" }, "items"));
    await hear(notice({ scope: "session", id: "conv-2" }, "items"));
    await act(async () => held!.land());
    await settle();
    expect(reads).toBe(before + 1);
  });

  it("keeps its subscription across a read that lists the same sessions, and adds a session the read newly lists", async () => {
    render(
      <LabProvider connection={{ userId: USER }}>
        <Probe seen={{}} />
      </LabProvider>,
    );
    await waitFor(() => expect(live()).toHaveLength(1));
    await settle();
    const first = live()[0]!;
    readAt += 60_000;
    await hear(notice({ scope: "user", resource: "projects/p1" }, "resource"));
    await settle();
    expect(live()).toEqual([first]);
    expect(subscribe).toHaveBeenCalledTimes(1);

    sessions = [...sessions, session("conv-2")];
    await hear(notice({ scope: "user", resource: "tasks/s%5Fconv-2%7Eab/task_1" }, "resource"));
    await waitFor(() => expect(live()[0]).not.toBe(first));
    expect(live()[0]!.topics).toEqual([{ scope: "user" }, { scope: "org" }, { scope: "session", id: "conv-1" }, { scope: "session", id: "conv-2" }]);
  });

  it("dims only while a read the user asked for runs, never on a read a notice started (D2)", async () => {
    const seen: { asking?: boolean; refresh?: () => Promise<void> } = {};
    render(
      <LabProvider connection={{ userId: USER }}>
        <Probe seen={seen} />
      </LabProvider>,
    );
    await waitFor(() => expect(live()).toHaveLength(1));
    await settle();
    expect(seen.asking).toBe(false);

    holdNext = true;
    await hear(notice({ scope: "session", id: "conv-1" }, "run"));
    await waitFor(() => expect(held).toBeDefined());
    expect(seen.asking).toBe(false);
    await act(async () => held!.land());
    await settle();

    held = undefined;
    holdNext = true;
    let asked!: Promise<void>;
    act(() => void (asked = seen.refresh!()));
    await waitFor(() => expect(held).toBeDefined());
    expect(seen.asking).toBe(true);
    await act(async () => {
      held!.land();
      await asked;
    });
    expect(seen.asking).toBe(false);
  });
});

describe("the summary's age and R", () => {
  async function openShiftCoordinator() {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://lab.local/");
    render(<App connection={{ userId: USER }} />);
    return screen.findByTestId("shift-coordinator-as-of");
  }

  it("says when the snapshot was last read, never that it is live, and moves when a read lands (D1)", async () => {
    const line = await openShiftCoordinator();
    expect(line.textContent).toBe(`as of ${clockTime(readAt)} · refresh`);
    expect(line.textContent).not.toMatch(/live/i);
    readAt += 5 * 60_000;
    await waitFor(() => expect(live()).toHaveLength(1));
    await hear(notice({ scope: "session", id: "conv-1" }, "request"));
    await waitFor(() => expect(screen.getByTestId("shift-coordinator-as-of").textContent).toBe(`as of ${clockTime(readAt)} · refresh`));
  });

  it("reads now from its refresh link and from R, dimming the counts until the read lands, but not from R typed in a field", async () => {
    await openShiftCoordinator();
    await settle();
    const before = reads;
    holdNext = true;
    fireEvent.click(screen.getByTestId("shift-coordinator-as-of-refresh"));
    await waitFor(() => expect(held).toBeDefined());
    expect(reads).toBe(before + 1);
    expect(screen.getByTestId("nav-inbox-count").getAttribute("data-asking")).toBe("true");
    expect(screen.getByTestId("shift-coordinator-summary").querySelector("[data-look='summary-prose']")!.getAttribute("data-asking")).toBe("true");
    await act(async () => held!.land());
    await waitFor(() => expect(screen.getByTestId("nav-inbox-count").getAttribute("data-asking")).toBeNull());

    act(() => void fireEvent.keyDown(window, { key: "r" }));
    await settle();
    expect(reads).toBe(before + 2);

    const field = document.createElement("input");
    document.body.appendChild(field);
    act(() => void fireEvent.keyDown(field, { key: "r" }));
    act(() => void fireEvent.keyDown(window, { key: "r", metaKey: true }));
    await settle();
    expect(reads).toBe(before + 2);
    field.remove();
  });
});
