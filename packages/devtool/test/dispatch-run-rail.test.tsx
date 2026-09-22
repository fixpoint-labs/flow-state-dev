/**
 * The rail shows dispatch runs under what started them (FIX-1440).
 *
 * The transport is a stubbed `fetch` rather than a mocked hook, because half of
 * what is under test is the REQUEST: a rail that drew the rows correctly from a
 * listing it never asked to widen would render identically here and show an
 * operator nothing on a real server.
 *
 * The other half is the indent, and it is asserted as one level and no more.
 * A run started by another run sits beside its own parent — the moment a second
 * level appears, the rail is a tree to walk again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { DevToolProvider } from "../src/react/context/devtool-context";
import { FlowRail } from "../src/react/components/flows/flow-rail";
import { useDevTool } from "../src/react/context/devtool-context";

const FLOWS = [
  { id: "reports", kind: "reports", cardinality: "singleton", requireUser: false, actions: [] },
];

/** One conversation, the run it dispatched, and a run that run dispatched. */
const SESSIONS = [
  { id: "sess_talk", title: "Weekly report" },
  {
    id: "dsx_1",
    title: "dsx_1",
    parentSessionId: "sess_talk",
    // A per-worker key: one seat's session, re-entered by every row it runs.
    topic: "worker|6:issues|9:implement",
    coordinate: "task:implement",
  },
  {
    id: "dsx_2",
    title: "dsx_2",
    parentSessionId: "dsx_1",
    topic: "task|6:issues|6:task-b",
    coordinate: "task:review",
  },
  // Dispatched into this flow from a conversation on ANOTHER one: the run is
  // listed here, its parent is not, and the two have different owners.
  {
    id: "dsx_cross",
    title: "dsx_cross",
    parentSessionId: "sess_absent",
    topic: "task|6:issues|6:task-c",
    coordinate: "task:summarize",
  },
];

let urls: string[] = [];

/**
 * Holds the addressed single-session read open so a test can act while it is in
 * flight. Null means "answer immediately", which is every other test here.
 */
let addressedGate: Promise<void> | null = null;

function stubTransport() {
  urls = [];
  addressedGate = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      const row = (session: Record<string, unknown>) => ({
        flowKind: "reports",
        userId: "devuser",
        createdAt: 1,
        updatedAt: 1,
        ...session,
      });
      // An addressed read of one session — what the parent link falls back to
      // when the parent is not among the listed rows.
      const addressed = /\/api\/flows\/sessions\/([^/?]+)$/.exec(url);
      if (addressed !== null && addressedGate !== null) await addressedGate;
      const body = addressed !== null
        ? { session: row({ id: addressed[1], flowId: "sender-flow" }) }
        : url.includes("/api/flows/sessions")
          ? { sessions: SESSIONS.map(row) }
          : { flows: FLOWS };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
}

beforeEach(stubTransport);
afterEach(() => vi.unstubAllGlobals());

const row = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-session-id="${id}"]`)!;

/** The row's own left padding — where the navigator puts the indent. */
const indent = (id: string) => row(id).style.paddingLeft;

/**
 * Which session the workspace is actually on, read from the same context the
 * rail writes to. Asserting the DOM of a row would only show what the rail
 * drew; this shows where the operator ended up.
 */
function SelectionProbe() {
  const { activeSessionId } = useDevTool();
  return <span data-testid="selected-session">{activeSessionId ?? ""}</span>;
}

const probe = () =>
  document.querySelector<HTMLElement>('[data-testid="selected-session"]')!;

async function openTheFlow() {
  render(
    <DevToolProvider initialConfig={{ userId: "devuser" }} userIdControl="host">
      <SelectionProbe />
      <FlowRail />
    </DevToolProvider>
  );
  await waitFor(() =>
    expect(document.querySelector('[data-kind="reports"]')).toBeTruthy()
  );
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-kind="reports"]')!.click();
  });
  await waitFor(() => expect(row("dsx_1")).toBeTruthy());
}

describe("the rail lists a flow's dispatch runs", () => {
  it("asks the server for them", async () => {
    await openTheFlow();

    const listing = urls.find((url) => url.includes("/api/flows/sessions"))!;
    expect(listing).toContain("include=dispatch-runs");
  });

  it("draws a run one level under the session that started it, and a run of a run beside its own parent", async () => {
    await openTheFlow();

    expect(indent("dsx_1")).not.toBe(indent("sess_talk"));
    // One level, and it stops there. `dsx_2` was started by `dsx_1`, so a tree
    // would push it a step further right.
    expect(indent("dsx_2")).toBe(indent("dsx_1"));
  });

  it("labels the row and links to the session that started it", async () => {
    await openTheFlow();

    // A seat's session is re-entered by every row that seat runs, so a reader
    // needs to know they are looking at an existing session, not new work.
    expect(
      document.querySelector('[data-dispatch-run-origin="re-used"]')
    ).toBeTruthy();
    // A per-task key names one body of work.
    expect(
      document.querySelector('[data-dispatch-run-origin="spawned"]')
    ).toBeTruthy();

    expect(
      document.querySelector('[data-open-parent-session="sess_talk"]')
    ).toBeTruthy();
    expect(
      document.querySelector('[data-open-parent-session="dsx_1"]')
    ).toBeTruthy();
  });

  it("puts no provenance chrome on a session a person started", async () => {
    await openTheFlow();

    expect(row("sess_talk").getAttribute("data-dispatch-run-of")).toBeNull();
  });
});

describe("opening the session that started a run", () => {
  it("opens a parent that is on screen without reading anything", async () => {
    await openTheFlow();
    urls.length = 0;

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-open-parent-session="sess_talk"]')!
        .click();
    });

    // `sess_talk` is a row of this same leaf, so the leaf's address owns it.
    // Reading the record to learn that would be a request for an answer already
    // on screen.
    expect(urls.filter((url) => url.includes("/api/flows/sessions/"))).toEqual([]);
  });

  it("resolves the owner of a parent that is not on screen", async () => {
    await openTheFlow();
    urls.length = 0;

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-open-parent-session="sess_absent"]')!
        .click();
    });

    // A cross-flow dispatch leaves the run owned by the instance it was sent to
    // and its parent owned by the sender. Opening the parent under the RUN's
    // owner addresses every later read to the wrong copy, so the owner is read
    // off the parent record instead of assumed.
    await waitFor(() =>
      expect(
        urls.some((url) => url.includes("/api/flows/sessions/sess_absent"))
      ).toBe(true)
    );
  });

  it("does not yank the operator back when they move on while the owner read is in flight", async () => {
    // The race the owner resolution introduced by becoming asynchronous. The
    // click is a request to go somewhere; by the time the record arrives the
    // operator may already be somewhere else, and honouring the stale answer
    // moves them off the session they chose. Nothing about the fetched record
    // is wrong — it is simply no longer what was asked for.
    let release!: () => void;
    addressedGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await openTheFlow();

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-open-parent-session="sess_absent"]')!
        .click();
    });

    // The operator picks a different session while the read is still open.
    await act(async () => {
      row("sess_talk").click();
    });

    await act(async () => {
      release();
      await Promise.resolve();
    });

    // Still where they went, not dragged to the run's parent.
    await waitFor(() =>
      expect(probe().textContent).toBe("sess_talk")
    );
  });
});
