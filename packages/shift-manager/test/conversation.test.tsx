// @vitest-environment happy-dom
/**
 * <Conversation> is the one way a view shows and sends into a conversation with
 * a worker. Drawn here as a view that isn't the Shift Coordinator's: another worker
 * and name, its own test ids, its own rendering of an item. The read and the
 * send are stood in for; what is checked is what the component does with them:
 * the session it reads and sends into, when it lets a line go, the read-back
 * while a reply is in flight, what a failed line leaves behind, and the retry
 * landing in the same session.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionSummary } from "@flow-state-dev/client";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAPS } from "../src/gaps";
import type { Worker } from "../src/lib/reads";
import { TurnNotDelivered } from "../src/lib/deliver";

const read = vi.fn();
const sendTurn = vi.fn();
const ensureWorkerSession = vi.fn();
// One object, as the provider hands one: a fresh `client` each render would re-read forever.
const lab = {
  client: { userId: "u_1" },
  refresh: vi.fn(),
  snapshot: { orgId: "org_1", sessions: [], inventory: { ok: true, value: { workers: [] } } },
};
const upload = vi.fn();
const retryTurn = vi.fn();
const workforce = { ensureWorkerSession, upload, retryTurn };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));
/** The session's turns, as workforce's session turns view reads them: how each ended, and whether the engine retries it. */
let turns: Array<{ id: string; status: string; retryable?: boolean }> = [];
vi.mock("@flow-state-dev/react", async (original) => {
  const real = await original<typeof import("@flow-state-dev/react")>();
  const turnsView = (await import("@flow-state-dev/workforce/browser")).sessionTurnsViewRef().view;
  type Rest = Parameters<typeof real.useView> extends [unknown, ...infer R] ? R : never;
  return { ...real, useView: (ref: { view: string }, ...rest: Rest) => (ref.view === turnsView ? { value: turns } : real.useView(ref as never, ...rest)) };
});
/**
 * Each follow a mounted conversation opened: the session, where its items go, and whether it
 * stopped. The follow's first answer is `read`'s; a case pushes what the session stream brings.
 */
type Follower = { onRead(read: { items: unknown[]; truncated: boolean; loadEarlier?: () => Promise<void> }): void; onFailure(failure: { message: string }): void };
const follows: Array<{ sessionId: string; to: Follower; closed: boolean }> = [];
/** Each mounted feed's restart, as the page's Retry calls it. */
const restarts = new Set<() => void>();
// The page's one feed for a session (`useSharedSessionFeed`), stood in for: its first answer is `read`'s,
// and a case pushes what the session stream brings. A failure after items landed keeps them, as the feed does.
vi.mock("../src/lib/session-feeds", async () => {
  const { useEffect, useState } = await import("react");
  return {
    // Retry opens the session's feed anew: here, a new follow whose first answer is `read`'s again.
    useRetrySessionFeed: () => () => {
      for (const restart of [...restarts]) restart();
    },
    useSharedSessionFeed: (sessionId: string | null) => {
      const [generation, setGeneration] = useState(0);
      useEffect(() => {
        const restart = () => setGeneration((n) => n + 1);
        restarts.add(restart);
        return () => void restarts.delete(restart);
      }, []);
      const [held, setHeld] = useState<{ sessionId: string; items?: unknown[]; hasEarlier: boolean; loadEarlier: () => Promise<void>; error: Error | null } | undefined>();
      useEffect(() => {
        if (sessionId === null) return;
        const to: Follower = {
          onRead: (got) => setHeld({ sessionId, items: got.items, hasEarlier: got.truncated, loadEarlier: got.loadEarlier ?? (async () => {}), error: null }),
          onFailure: (why) => setHeld((was) => (was?.items !== undefined ? was : { sessionId, hasEarlier: false, loadEarlier: async () => {}, error: new Error(why.message) })),
        };
        const entry = { sessionId, to, closed: false };
        follows.push(entry);
        Promise.resolve(read(lab.client, sessionId)).then(
          (got) => !entry.closed && to.onRead(got),
          (error: unknown) => !entry.closed && to.onFailure({ message: error instanceof Error ? error.message : String(error) }),
        );
        return () => void (entry.closed = true);
      }, [sessionId, generation]);
      return held === undefined || held.sessionId !== sessionId ? undefined : { ...held, state: "live", runs: null, followResponse: () => {} };
    },
  };
});
/** What the session stream brings to the open follow. */
const streamed = (items: unknown[]) => act(async () => follows.filter((f) => !f.closed).at(-1)!.to.onRead({ items, truncated: false }));
// The one send path (`useDeliverLine`), stood in for: `sendTurn(client, target, message, options)`.
vi.mock("../src/lib/deliver", async (original) => ({
  ...(await original<typeof import("../src/lib/deliver")>()),
  useDeliverLine: () => (to: unknown, message: string, options: unknown) => sendTurn(lab.client, to, message, options),
}));
// A page with no Web Crypto can't hash a derived address: this worker's derivation fails the way it would there.
const UNHASHABLE = "eng.unhashable";
vi.mock("@flow-state-dev/workforce/browser", async (original) => {
  const real = await original<typeof import("@flow-state-dev/workforce/browser")>();
  return {
    ...real,
    deriveWorkerSessionId: (input: Parameters<typeof real.deriveWorkerSessionId>[0]) =>
      input.criteria.worker === UNHASHABLE ? Promise.reject(new Error("crypto.subtle is not available")) : real.deriveWorkerSessionId(input),
  };
});

import { deriveWorkerSessionId } from "@flow-state-dev/workforce/browser";
import { Conversation } from "../src/components/Conversation";
import { RECEIVED_MESSAGE_DATA_TYPE, TASK_RESULT_DATA_TYPE, taskBriefMetadata } from "@flow-state-dev/workforce/browser";

// The reviewer's conversation: the session at its derived address, where a worker's message lands too.
const s1 = await deriveWorkerSessionId({ userId: "u_1", orgId: "org_1", flow: "agent", criteria: { worker: "eng.reviewer" } });

// A worker on the shared `agent` flow: its sessions are that flow's, naming it as their worker.
const worker = { id: "eng.reviewer", kind: "agent", door: "talk" } as unknown as Worker;
const session = (id: string): SessionSummary =>
  ({ id, flowKind: "agent", flowId: "agent", state: { workerId: "eng.reviewer" }, createdAt: 1, parentSessionId: null }) as unknown as SessionSummary;
const item = (id: string, text: string) => ({ id, requestId: "r", type: "message", role: "assistant", ts: Date.UTC(2026, 9, 7, 17, 34), text, content: [{ type: "output_text", text }] });
const delivered = { requestId: "q", suspended: false, stopped: null };

beforeEach(() => {
  read.mockReset();
  follows.length = 0;
  sendTurn.mockReset();
  ensureWorkerSession.mockReset();
  ensureWorkerSession.mockResolvedValue({ id: s1 });
  lab.refresh.mockReset();
  read.mockResolvedValue({ items: [], truncated: false });
  retryTurn.mockReset();
  retryTurn.mockResolvedValue(undefined);
  turns = [];
});
afterEach(() => cleanup());

const drawnElement = (sessions: SessionSummary[], over: Partial<Parameters<typeof Conversation>[0]> = {}) => (
  <Conversation
    worker={worker}
    sessions={sessions}
    gaps={GAPS}
    name="Reviewer"
    testId="rev"
    emptyText="Nothing said to the reviewer yet."
    // The view draws the worker's messages its own way and leaves every other line to the registry, as a real view does.
    renderItem={(it) => (it.type === "message" ? <span data-testid="mine">{(it as unknown as { text: string }).text}</span> : undefined)}
    {...over}
  />
);
const drawn = (sessions: SessionSummary[], over: Partial<Parameters<typeof Conversation>[0]> = {}) =>
  render(drawnElement(sessions, over));

/** Type a line and press send, once the composer has let go of "Reading the conversation first…". */
async function send(line: string) {
  const input = screen.getByTestId("rev-composer-input") as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.change(input, { target: { value: line } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("rev-composer-send"));
  });
}

describe("what a view of its own draws", () => {
  it("says what it is before a first line, under that view's own ids", async () => {
    drawn([]);
    expect((await screen.findByTestId("rev-conversation-empty")).textContent).toBe("Nothing said to the reviewer yet.");
    expect(screen.getByTestId("rev-composer")).toBeTruthy();
    expect(screen.queryByTestId("shift-coordinator")).toBeNull();
  });

  it("offers its starter lines before a first line; a click fills the composer and sends nothing", async () => {
    drawn([], { starters: ["What can the team do for me?", "Hand Triage something to look into"] });
    expect((await screen.findByTestId("rev-conversation-empty")).textContent).toBe("Nothing said to the reviewer yet.");
    fireEvent.click(screen.getByRole("button", { name: "Hand Triage something to look into" }));
    const input = screen.getByTestId("rev-composer-input") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("Hand Triage something to look into"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it("says what it is in a session opened before a first line, rather than drawing nothing", async () => {
    // A session can exist and read empty (its first line failed after it opened, or a
    // standing-rules read wrote only undrawn items): the screen must still say what it is.
    drawn([], { session: "s1" });
    expect((await screen.findByTestId("rev-conversation-empty")).textContent).toBe("Nothing said to the reviewer yet.");
    expect(read.mock.calls[0]![1]).toBe("s1");
  });

  it("says what it is in a session that holds only items the feed never draws, rather than drawing an empty list", async () => {
    // Reading the worker's standing rules runs in this session before any line is sent, and the Lab
    // keeps the write it makes: the user has still said nothing, so the screen must say so.
    read.mockResolvedValue({
      items: [
        { id: "sc1", requestId: "r", type: "state_change", ts: 1 },
        { id: "rc1", requestId: "r", type: "resource_change", ts: 1 },
        { id: "sr1", requestId: "r", type: "suspension_resume", ts: 1 },
        { id: "co1", requestId: "r", type: "continuation", ts: 1 },
      ],
      truncated: false,
    });
    drawn([session(s1)]);
    expect((await screen.findByTestId("rev-conversation-empty")).textContent).toBe("Nothing said to the reviewer yet.");
    expect(screen.queryByTestId("rev-items")).toBeNull();
    expect(screen.queryByTestId("mine")).toBeNull();
  });

  it("doesn't call a cut-short read empty when what it holds draws nothing: later items may", async () => {
    const loadEarlier = vi.fn(async () => {});
    read.mockResolvedValue({ items: [{ id: "sc1", requestId: "r", type: "state_change", ts: 1 }], truncated: true, loadEarlier });
    drawn([session(s1)]);
    expect(await screen.findByTestId("rev-load-earlier")).toBeTruthy();
    expect(screen.queryByTestId("rev-conversation-empty")).toBeNull();
  });

  it("offers Load earlier while the session holds older items, and asks the follow for them", async () => {
    const loadEarlier = vi.fn(async () => {});
    read.mockResolvedValue({ items: [item("b", "Newer")], truncated: true, loadEarlier });
    drawn([session(s1)]);
    fireEvent.click(await screen.findByTestId("rev-load-earlier-button"));
    expect(loadEarlier).toHaveBeenCalledTimes(1);
    // The follow hears the longer list; once it holds the start, there is nothing earlier to offer.
    await streamed([item("a", "Older"), item("b", "Newer")]);
    expect(screen.getAllByTestId("mine").map((el) => el.textContent)).toEqual(["Older", "Newer"]);
    expect(screen.queryByTestId("rev-load-earlier")).toBeNull();
  });

  it("keeps its look hooks the same whatever its test id, so one rule styles every conversation", () => {
    const { container } = drawn([]);
    expect(container.querySelector('[data-look="conversation-feed"]')).toBeTruthy();
    expect(container.querySelector('[data-look="rev-feed"]')).toBeNull();
  });

  it("reads the worker's session, labels its messages with the view's name, and lets the view draw them", async () => {
    read.mockResolvedValue({ items: [item("a", "Looks good"), item("b", "One nit")], truncated: false });
    drawn([session(s1)]);
    expect((await screen.findAllByTestId("mine")).map((n) => n.textContent)).toEqual(["Looks good", "One nit"]);
    expect(read.mock.calls[0]![1]).toBe(s1);
    expect(screen.getAllByText("REVIEWER")).toHaveLength(2);
  });

  it("draws another worker's message as its own item under its sender's name, with a link to Messages, whatever the view draws", async () => {
    const received = {
      id: "m",
      requestId: "r",
      type: "data",
      dataType: RECEIVED_MESSAGE_DATA_TYPE,
      ts: Date.UTC(2026, 9, 7, 17, 33),
      value: { id: "msg_1", from: "eng.author", text: "the codename?", inReplyTo: "msg_0" },
    };
    read.mockResolvedValue({ items: [received, item("a", "BLUE-HERON")], truncated: false });
    drawn([session(s1)]);
    await screen.findAllByTestId("mine");
    // The view's renderItem draws its own messages, never another worker's.
    expect(screen.getAllByTestId("mine").map((n) => n.textContent)).toEqual(["BLUE-HERON"]);
    const drawnMessage = document.querySelector<HTMLElement>("[data-line=received]")!;
    // Under the sender's name; the label is set in capitals by its style, not its text.
    expect(drawnMessage.textContent).toContain("eng.author");
    expect(drawnMessage.textContent).toContain("the codename?");
    expect(drawnMessage.textContent).toContain("· reply");
    expect(screen.getAllByTestId("messages-link")).toHaveLength(1);
    expect(screen.getAllByText("REVIEWER")).toHaveLength(1);
  });

  it("doesn't mark a task's brief as a line the user sent; a typed line still is", async () => {
    const typed = { id: "u1", requestId: "r", type: "message", role: "user", ts: 1, text: "Keep the old flag name." };
    const brief = { ...typed, id: "b1", text: "Fix the flaky test.", metadata: taskBriefMetadata({ taskId: "t1" }) };
    read.mockResolvedValue({ items: [brief, typed], truncated: false });
    drawn([session(s1)]);
    await screen.findAllByTestId("mine");
    const [briefRow, typedRow] = screen.getAllByTestId("rev-item");
    // Jump-to-latest follows the user's own sends; the brief was handed to the session, not sent by them.
    expect(briefRow!.hasAttribute("data-sent-line")).toBe(false);
    expect(typedRow!.getAttribute("data-sent-line")).toBe("u1");
  });

  it("says the worker has the line while one from this page is in flight", () => {
    drawn([], { working: true });
    expect(screen.getByTestId("rev-working").textContent).toContain("Reviewer is working on it");
  });
});

describe("a turn that didn't finish", () => {
  const typed = { id: "u1", requestId: "q1", type: "message", role: "user", status: "completed", ts: 1, content: [{ type: "input_text", text: "Ship it." }] };
  const failure = { id: "e1", requestId: "q1", type: "error", status: "failed", ts: 2, message: "The model provider is down.", code: "PROVIDER_ERROR" };

  it("says why it failed, with Retry when the engine retries it, which retries that turn in this session", async () => {
    turns = [{ id: "q1", status: "failed", retryable: true }];
    read.mockResolvedValue({ items: [typed, failure], truncated: false });
    drawn([session(s1)]);
    const line = await screen.findByTestId("request-recovery");
    expect(line.textContent).toContain("The model provider is down.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry/ })));
    expect(retryTurn).toHaveBeenCalledWith(s1, "q1");
  });

  it("offers no Retry on a turn the engine won't retry", async () => {
    turns = [{ id: "q1", status: "failed", retryable: false }];
    read.mockResolvedValue({ items: [typed, failure], truncated: false });
    drawn([session(s1)]);
    expect((await screen.findByTestId("request-recovery")).textContent).toContain("The model provider is down.");
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("says you stopped it, after its last line", async () => {
    turns = [{ id: "q1", status: "aborted" }];
    read.mockResolvedValue({ items: [typed, item("a", "Half an ans")].map((it) => ({ ...it, requestId: "q1" })), truncated: false });
    drawn([session(s1)]);
    await screen.findAllByTestId("mine");
    const lines = screen.getAllByTestId("rev-item");
    expect(lines.at(-1)!.textContent).toContain("Interrupted by you");
  });
});

describe("a task this worker filed", () => {
  it("draws its result where the board ended it", async () => {
    const ended = { id: "res1", requestId: "q2", type: "data", status: "completed", ts: 3, dataType: TASK_RESULT_DATA_TYPE, value: { taskId: "t1", from: "eng.coder", title: "Fix the flaky test", text: "Fixed: the retry raced the timer.", ending: "done" } };
    read.mockResolvedValue({ items: [ended], truncated: false });
    drawn([session(s1)]);
    await waitFor(() => expect(screen.getAllByTestId("rev-item")).toHaveLength(1));
    expect(screen.getByTestId("rev-item").textContent).toContain("Fixed: the retry raced the timer.");
  });
});

describe("when a line may go", () => {
  it("holds it until a listed session has been read, then lets it through", async () => {
    let release!: (v: unknown) => void;
    read.mockReturnValue(new Promise((resolve) => (release = resolve)));
    drawn([session(s1)]);
    expect(screen.getByTestId("rev-composer-blocked").textContent).toBe("Reading the conversation first…");
    await act(async () => release({ items: [], truncated: false }));
    expect(screen.queryByTestId("rev-composer-blocked")).toBeNull();
  });

  it("sends nothing to a worker that takes no message, and says why", () => {
    drawn([], { worker: { id: "eng.reviewer", kind: "agent", door: null } as unknown as Worker });
    expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("eng.reviewer");
  });

  it("sends nothing to a worker whose flow it can't name, since its session couldn't be opened", () => {
    drawn([], { worker: { id: "eng.reviewer", kind: null, door: "talk" } as unknown as Worker });
    expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("eng.reviewer");
  });

  it("isn't another worker's conversation on the same flow", async () => {
    const theirs = { ...session("s9"), state: { workerId: "eng.author" } } as unknown as SessionSummary;
    drawn([theirs]);
    expect(await screen.findByTestId("rev-conversation-empty")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("holds it, and says why, when the conversation's address couldn't be worked out, rather than reading forever", async () => {
    drawn([], { worker: { id: UNHASHABLE, kind: "agent", door: "talk" } as unknown as Worker });
    await waitFor(() => expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("didn't load"));
    expect(ensureWorkerSession).not.toHaveBeenCalled();
  });

  it("holds it when the conversation failed to load", async () => {
    read.mockRejectedValue(new Error("down"));
    drawn([session(s1)]);
    // The composer is blocked from the first render ("Reading the conversation first…"), so a
    // findByTestId would return before the failed read re-renders it; wait for the failure's text.
    await waitFor(() => expect(screen.getByTestId("rev-composer-blocked").textContent).toContain("didn't load"));
  });
});

describe("an open conversation", () => {
  afterEach(() => vi.useRealTimers());

  it("follows the session's stream, so another worker's message shows as it lands, with no read on a clock (FIX-1989, FIX-2466)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    drawn([session(s1)]);
    await act(async () => {});
    expect(follows.map((f) => f.sessionId)).toEqual([s1]);
    expect(screen.queryByTestId("mine")).toBeNull();
    // Nothing reads again while nothing changes, however long the view stays open.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(read).toHaveBeenCalledTimes(1);
    await streamed([item("i1", "From eng.author: the build is green.")]);
    expect(screen.getByTestId("mine").textContent).toBe("From eng.author: the build is green.");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps the last read on screen, and the composer open, when the follow fails later", async () => {
    read.mockResolvedValueOnce({ items: [item("i1", "Shipped.")], truncated: false });
    drawn([session(s1)]);
    await waitFor(() => expect(screen.getByTestId("mine").textContent).toBe("Shipped."));
    await act(async () => follows.at(-1)!.to.onFailure({ message: "down" }));
    expect(screen.getByTestId("mine").textContent).toBe("Shipped.");
    expect(screen.queryByTestId("rev-composer-blocked")).toBeNull();
  });

  // A feed whose first read gave up never reads again on its own: Retry opens it anew.
  it("opens the session's feed anew on Retry after a first read failed, and stops the feed it replaced", async () => {
    read.mockRejectedValueOnce(new Error("down"));
    drawn([session(s1)]);
    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));
    await waitFor(() => expect(follows).toHaveLength(2));
    expect(follows[0]!.closed).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("rev-conversation-failure")).toBeNull());
  });

  it("sends nothing into a session the view draws read-only, and says why, whatever the worker", async () => {
    drawn([session(s1)], { readOnly: "This is a task's session. It is read here, not written to." });
    await act(async () => {});
    expect(screen.getByTestId("rev-composer-blocked").textContent).toBe("This is a task's session. It is read here, not written to.");
  });
});

describe("a draft is kept per conversation", () => {
  afterEach(() => window.localStorage.clear());
  const box = async () => {
    const input = screen.getByTestId("rev-composer-input") as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    return input;
  };

  it("keeps a session the view names apart from the same worker's other sessions (two projects, one coordinator)", async () => {
    const a = drawn([session("sess-project-a"), session("sess-project-b")], { session: "sess-project-a" });
    fireEvent.change(await box(), { target: { value: "for project a only" } });
    a.unmount();

    const b = drawn([session("sess-project-a"), session("sess-project-b")], { session: "sess-project-b" });
    expect((await box()).value).toBe("");
    b.unmount();
    drawn([session("sess-project-a"), session("sess-project-b")], { session: "sess-project-a" });
    expect((await box()).value).toBe("for project a only");
  });

  it("keeps a project conversation's draft once its session exists (a reload after the first line, or another tab opened it)", async () => {
    // Before its first line a project's conversation keeps its draft under the project; once the
    // session is found, under the session. A line typed in between must not be lost on the move.
    const apollo = { visibility: "shared", id: "apollo" } as const;
    const before = drawn([], { project: apollo });
    fireEvent.change(await box(), { target: { value: "the second line, unsent" } });
    before.unmount();

    drawn([session("sess-pc")], { session: "sess-pc", project: apollo });
    expect((await box()).value).toBe("the second line, unsent");
  });

  it("drops a first line that went out while the composer reopened on the session's key", async () => {
    // Her first line opens the session; she leaves the Stream and comes back before the session
    // holds it, so the composer reopens on the session's key and takes the line with it. Once
    // the send lands, the line is gone from the draft: left there, a second Send repeats the work.
    const apollo = { visibility: "shared", id: "apollo" } as const;
    ensureWorkerSession.mockResolvedValue({ id: "sess-pc" });
    let land: (() => void) | undefined;
    sendTurn.mockImplementation(
      (_client: unknown, _target: unknown, _message: unknown, on: { onHeld: () => void }) =>
        new Promise((resolve) => {
          land = () => {
            on.onHeld();
            resolve(delivered);
          };
        }),
    );
    const before = drawn([], { project: apollo });
    fireEvent.change(await box(), { target: { value: "the first line" } });
    fireEvent.click(screen.getByTestId("rev-composer-send"));
    await waitFor(() => expect(land).toBeDefined());
    before.unmount();

    drawn([session("sess-pc")], { session: "sess-pc", project: apollo });
    expect((await box()).value).toBe("the first line");
    await act(async () => land!());
    await waitFor(() => expect((screen.getByTestId("rev-composer-input") as HTMLInputElement).value).toBe(""));
    cleanup();
    drawn([session("sess-pc")], { session: "sess-pc", project: apollo });
    expect((await box()).value).toBe("");
  });
});

describe("sending", () => {
  it("goes through the one send path, to the worker's door, into the session read", async () => {
    sendTurn.mockResolvedValue(delivered);
    drawn([session(s1)]);
    await send("ship it?");
    // To the worker's flow, never an address carrying the worker; the session names the worker.
    expect(sendTurn.mock.calls[0]![1]).toEqual({ sessionId: s1 });
    expect(ensureWorkerSession).not.toHaveBeenCalled();
    expect(sendTurn.mock.calls[0]![2]).toBe("ship it?");
  });

  it("shows the line once the session holds it, while the reply is still in flight, from the stream it already follows", async () => {
    let finish!: () => void;
    sendTurn.mockImplementation(async (_c, _t, _m, opts: { onHeld: () => void }) => {
      opts.onHeld();
      await new Promise<void>((resolve) => (finish = resolve));
      return delivered;
    });
    drawn([session(s1)]);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await send("one more");
    await streamed([item("u1", "one more")]);
    expect(screen.getByTestId("mine").textContent).toBe("one more");
    expect(screen.getByTestId("rev-composer-status").getAttribute("data-state")).not.toBe("delivered");
    // One follow, opened once: a send reads nothing again.
    expect(read).toHaveBeenCalledTimes(1);
    expect(follows).toHaveLength(1);
    await act(async () => finish());
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads the Lab again and shows the reason when the door refuses, keeping the line", async () => {
    sendTurn.mockRejectedValue(new TurnNotDelivered("refused", "no thanks"));
    drawn([session(s1)]);
    await send("nope");
    expect(lab.refresh).toHaveBeenCalled();
    expect(screen.getByTestId("rev-composer-error").textContent).toContain("no thanks");
    expect((screen.getByTestId("rev-composer-input") as HTMLInputElement).value).toBe("nope");
  });

  it("starts a conversation with a first line at the worker's derived address, and a retry lands in the same session", async () => {
    sendTurn.mockRejectedValueOnce(new TurnNotDelivered("not-sent", "offline")).mockResolvedValue(delivered);
    drawn([]);
    await send("hello");
    await send("hello");
    const [first, second] = sendTurn.mock.calls.map((call) => (call[1] as { sessionId: string }).sessionId);
    // The address another worker's message lands in, so the user and the workers share one conversation.
    expect(first).toBe(s1);
    expect(second).toBe(first);
    // Opened through Workforce, naming the worker, before the door's request runs in it.
    expect(ensureWorkerSession.mock.calls[0]![0]).toEqual({ worker: "eng.reviewer" });
    expect(ensureWorkerSession.mock.invocationCallOrder[0]!).toBeLessThan(sendTurn.mock.invocationCallOrder[0]!);
  });

  it("isn't a session the user opened with the worker at any other id", async () => {
    drawn([session("conv_random")]);
    expect(await screen.findByTestId("rev-conversation-empty")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("sends a line handed in from elsewhere once, as if typed", async () => {
    sendTurn.mockResolvedValue(delivered);
    const taken = vi.fn();
    // As the Shift Coordinator hands it in: the line is held until taken, then cleared.
    function Handing() {
      const [line, setLine] = useState<string | null>("from the palette");
      return (
        <>
          {drawnElement([session(s1)], {
            autoSend: line,
            onAutoSend: () => {
              taken();
              setLine(null);
            },
          })}
        </>
      );
    }
    render(<Handing />);
    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    expect(sendTurn.mock.calls[0]![2]).toBe("from the palette");
    // Settled, the composer is free again: the line is not taken a second time.
    await waitFor(() => expect((screen.getByTestId("rev-composer-input") as HTMLInputElement).value).toBe(""));
    expect(taken).toHaveBeenCalledTimes(1);
    expect(sendTurn).toHaveBeenCalledTimes(1);
  });
});

// A worker flow that signs in its own callers holds an upload for the user
// its sends resolve only when the upload goes through that flow: the Lab-wide
// upload route runs the host's sign-in, and the send would then find no file.
describe("a line's files", () => {
  it("upload through workforce's upload, by the worker, which goes through the worker's own flow", async () => {
    upload.mockReset();
    upload.mockResolvedValue({ type: "file", mediaType: "image/png", filename: "bug.png", data: "fsd-blob:b_viaflow000001" });
    drawn([]);
    const input = screen.getByTestId("rev-composer-input");
    const shot = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "bug.png", { type: "image/png" });
    await act(async () => {
      fireEvent.paste(input, { clipboardData: { items: [{ kind: "file", getAsFile: () => shot }], files: [shot] } });
    });
    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload.mock.calls[0]![0]).toBe("eng.reviewer");
  });
});
