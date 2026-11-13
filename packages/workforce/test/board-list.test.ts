// @vitest-environment happy-dom
/**
 * `BoardList`: one board as a list with each task's status (FIX-1622 V1), and
 * its `live` re-read (V2, V3; on board notices since FIX-2429).
 *
 * `client.subscribe` is faked at the client seam, so each live case hands the
 * list exactly the notices it would hear and counts the board reads it makes.
 * Reads are counted rather than only the rows asserted, because a list that
 * polls, or re-reads on every notice of a burst, draws the same rows. The
 * transport cases run the real client against a host `fetch`, since "the
 * subscription carries the read's credential, to the read's origin" is the
 * list and the client together.
 *
 * Every read the list makes is held until the case releases it, so "a change
 * that lands mid-read" is a notice delivered while a read is still open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { createClient, type Client, type SubscribeOptions, type WireNotice, type WireTopic } from "@flow-state-dev/client";

const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }> = [];

/** `client.subscribe`, faked: captured so a case can deliver notices. */
const fakeSubscribe: Client["subscribe"] = (topics, options) => {
  const entry = { topics, options, closed: false };
  subscriptions.push(entry);
  return {
    close: () => {
      entry.closed = true;
    }
  };
};

/** A host client: the board read the case controls, and the faked subscribe. */
function hostClient<T extends { listCollectionResources: unknown }>(resources: T) {
  return { resources, subscribe: fakeSubscribe } as unknown as {
    resources: T & import("@flow-state-dev/client").ResourcesApi;
    subscribe: Client["subscribe"];
  };
}

import { BoardList, boardListPropNames } from "../src/react/components/BoardList";
import { FlowProvider } from "@flow-state-dev/react";

const BOARD = "eng.feature.triage";
const SESSION = "s1";

type Listed = { topic: string; clientData: unknown };

const card = (id: string, status: string, extra: Record<string, unknown> = {}): Listed => ({
  topic: id,
  clientData: { id, status, ...extra }
});

/**
 * A board source whose every read stays open until the case releases it, and
 * which answers with whatever rows the board holds at that moment.
 */
function heldSource(initial: Listed[]) {
  let rows = initial;
  const open: Array<() => void> = [];
  const listCollectionResources = vi.fn(
    () =>
      new Promise<{ items: Listed[] }>((resolve) => {
        open.push(() => resolve({ items: rows }));
      })
  );
  return {
    listCollectionResources,
    setRows: (next: Listed[]) => {
      rows = next;
    },
    /** Reads still open. */
    pending: () => open.length,
    /** Answer the oldest open read. */
    release: async () => {
      const next = open.shift();
      if (next === undefined) throw new Error("no read is open");
      await act(async () => {
        next();
        await Promise.resolve();
      });
    }
  };
}

/** A source that answers at once, and counts. */
function fixedSource(items: Listed[]) {
  return { listCollectionResources: vi.fn(async () => ({ items })) };
}

function openSubscription() {
  const open = subscriptions.filter((s) => !s.closed);
  const last = open[open.length - 1];
  if (last === undefined) throw new Error("no open subscription");
  return last;
}

/** Hand the open subscription what `client.subscribe` would: a notice, or `null` for a connect, reconnect or tick. */
function hear(notice: WireNotice | null): void {
  const { options } = openSubscription();
  act(() => options.onChange(notice));
}

/** A board notice on the session's topic, narrowed to `board`. */
const boardNotice = (board: string = BOARD): WireNotice => ({
  topic: { scope: "session", id: SESSION, resource: board },
  kind: "board",
  origin: { requestId: "req_1" }
});

const rowIds = () => [...document.querySelectorAll("li[data-task-id]")].map((li) => li.getAttribute("data-task-id"));
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

beforeEach(() => {
  subscriptions.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// V1 · the list
// ---------------------------------------------------------------------------

describe("BoardList · the list (V1)", () => {
  it("draws one row per task with its status word, newest first, and no status columns (BR-2, BR-3)", async () => {
    const source = fixedSource([
      card("t-old", "completed", { title: "Old task", createdAt: 1_000 }),
      card("t-undated", "cancelled", { goal: "No date on this one" }),
      card("t-new", "pending", { title: "New task", createdAt: 3_000, assignee: "ada" }),
      card("t-mid", "in_progress", { createdAt: 2_000 })
    ]);
    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, client: hostClient(source) }));

    await waitFor(() => expect(rowIds()).toHaveLength(4));
    // Newest first by `createdAt`; a row without one follows, in read order.
    expect(rowIds()).toEqual(["t-new", "t-mid", "t-old", "t-undated"]);
    // Nothing is hidden whatever its status, and no column is drawn.
    expect(document.querySelector("[data-column]")).toBeNull();
    // Each row: the label (title, else goal, else id) and the status word.
    const text = (id: string) => document.querySelector(`li[data-task-id="${id}"]`)?.textContent;
    expect(text("t-new")).toBe("New taskpendingada");
    expect(text("t-undated")).toBe("No date on this onecancelled");
    expect(text("t-mid")).toBe("t-midin_progress");
    expect(source.listCollectionResources).toHaveBeenCalledWith(SESSION, BOARD, {});
  });

  it("shows a status it does not know as its own word (BR-4)", async () => {
    render(
      createElement(BoardList, {
        sessionId: SESSION,
        boardRef: BOARD,
        client: hostClient(fixedSource([card("t-1", "blocked_upstream")]))
      })
    );
    await waitFor(() => expect(rowIds()).toHaveLength(1));
    const status = (id: string) =>
      document.querySelector(`li[data-task-id="${id}"] [data-task-status]`)?.textContent;
    expect(status("t-1")).toBe("blocked_upstream");
  });

  it("keeps loading, empty and a failed read apart, and offers a retry on failure (BR-6, BR-7)", async () => {
    const pending = { listCollectionResources: vi.fn(() => new Promise<never>(() => {})) };
    const { unmount } = render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, client: hostClient(pending) }));
    expect(document.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
    unmount();

    const { unmount: unmountEmpty } = render(
      createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, client: hostClient(fixedSource([])) })
    );
    await waitFor(() => expect(document.querySelector('[data-state="empty"]')).not.toBeNull());
    expect(document.querySelector('[data-state="loading"]')).toBeNull();
    unmountEmpty();

    let fail = true;
    const flaky = {
      listCollectionResources: vi.fn(async () => {
        if (fail) throw new Error("board unavailable");
        return { items: [card("t-1", "pending")] };
      })
    };
    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, client: hostClient(flaky) }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("board unavailable"));
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
    // Nothing retries by itself.
    await settle();
    expect(flaky.listCollectionResources).toHaveBeenCalledTimes(1);
    fail = false;
    await act(async () => screen.getByRole("button", { name: "Retry" }).click());
    await waitFor(() => expect(rowIds()).toEqual(["t-1"]));
  });

  it("errors rather than draw a partial list when the board never stops paging", async () => {
    // A transport that hands back a `nextCursor` forever, one row per page.
    let n = 0;
    const endless = {
      listCollectionResources: vi.fn(async () => {
        const row = card(`t-${n++}`, "pending");
        return { items: [row], nextCursor: row.topic };
      })
    };
    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, client: hostClient(endless) }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/more still to read/));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(rowIds()).toEqual([]);
    // Stops at the ceiling rather than reading forever.
    expect(endless.listCollectionResources).toHaveBeenCalledTimes(1000);
  });

  it("wraps a host's row body in the list's own row, and says what a host's empty slot says", async () => {
    render(
      createElement(BoardList, {
        sessionId: SESSION,
        boardRef: BOARD,
        client: hostClient(fixedSource([card("t-1", "pending", { title: "Charger fire" })])),
        slots: { row: (row) => createElement("span", { "data-host-row": row.card.id }, `${row.card.title}!`) }
      })
    );
    await waitFor(() => expect(document.querySelector("[data-host-row]")).not.toBeNull());
    const li = document.querySelector('li[data-task-id="t-1"]')!;
    expect(li.querySelector("li")).toBeNull();
    expect(li.textContent).toBe("Charger fire!");
    cleanup();

    render(
      createElement(BoardList, {
        sessionId: SESSION,
        boardRef: BOARD,
        client: hostClient(fixedSource([])),
        slots: { empty: () => createElement("p", { "data-host-empty": "" }, "Nobody needs a person.") }
      })
    );
    await waitFor(() => expect(document.querySelector("[data-host-empty]")?.textContent).toBe("Nobody needs a person."));
  });

  it("publishes the props it takes, and no organization filter", () => {
    expect([...boardListPropNames]).toEqual(["boardRef", "client", "limit", "live", "sessionId", "slots"]);
  });
});

// ---------------------------------------------------------------------------
// V2 · live
// ---------------------------------------------------------------------------

describe("BoardList · live (V2)", () => {
  function renderLive(source: ReturnType<typeof heldSource>) {
    return render(
      createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, client: hostClient(source), live: true })
    );
  }

  /** Mount a live list and let its mount read land. Hands back the source at one read. */
  async function mountLive(rows: Listed[] = [card("t-1", "pending")]) {
    const source = heldSource(rows);
    const view = renderLive(source);
    await source.release();
    await waitFor(() => expect(rowIds()).toHaveLength(rows.length));
    expect(source.listCollectionResources).toHaveBeenCalledTimes(1);
    return { source, view };
  }

  it("without live, subscribes nothing and reads once (BR-17)", async () => {
    const source = fixedSource([card("t-1", "pending")]);
    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, client: hostClient(source) }));
    await waitFor(() => expect(rowIds()).toEqual(["t-1"]));
    await settle();
    expect(subscriptions).toHaveLength(0);
    expect(source.listCollectionResources).toHaveBeenCalledTimes(1);
  });

  it("subscribes its session's topic narrowed to the board, with a timer for where push can miss a change, and reads on mount", async () => {
    const source = heldSource([]);
    renderLive(source);
    expect(subscriptions).toHaveLength(1);
    // Narrowed: a streaming reply's `items` notices on the session never wake it.
    expect(subscriptions[0]!.topics).toEqual([{ scope: "session", id: SESSION, resource: BOARD }]);
    expect(subscriptions[0]!.options.pollIntervalMs).toEqual(expect.any(Number));
    // The mount read: on a host with no push, nothing else reads before the first tick.
    expect(source.pending()).toBe(1);
  });

  it("reads again on a connect or reconnect, which may have missed a change", async () => {
    const { source } = await mountLive();
    hear(null);
    expect(source.pending()).toBe(1);
    await source.release();
    expect(source.listCollectionResources).toHaveBeenCalledTimes(2);
  });

  it("reads nothing until something under its topic changes", async () => {
    const { source } = await mountLive();
    await settle();
    expect(source.pending()).toBe(0);
    expect(source.listCollectionResources).toHaveBeenCalledTimes(1);
  });

  it("reads the board again on a board notice, and draws the read, never anything the notice says (BR-8, BR-9)", async () => {
    const { source } = await mountLive([card("t-1", "pending", { title: "Charger fire" })]);
    source.setRows([card("t-1", "completed", { title: "Charger fire" })]);
    hear(boardNotice());
    expect(source.pending()).toBe(1);
    await source.release();
    expect(source.listCollectionResources).toHaveBeenCalledTimes(2);
    expect(document.querySelector('li[data-task-id="t-1"] [data-task-status]')?.textContent).toBe("completed");
  });

  it("reads at most once more for a burst, with one read in flight and one queued (BR-11)", async () => {
    const { source } = await mountLive();
    for (let n = 0; n < 5; n += 1) hear(boardNotice());
    // One in flight, and the other four queued as one.
    expect(source.pending()).toBe(1);
    await source.release();
    expect(source.pending()).toBe(1);
    await source.release();
    await settle();
    expect(source.pending()).toBe(0);
    expect(source.listCollectionResources).toHaveBeenCalledTimes(3);
  });

  it("reads a change that lands while the mount read pages in exactly one read after it", async () => {
    const source = heldSource([]);
    renderLive(source);
    // Heard while the mount read is still open: that read may or may not hold it.
    hear(boardNotice());
    hear(boardNotice());
    source.setRows([card("t-new", "pending"), card("t-more", "pending")]);
    expect(source.pending()).toBe(1);
    await source.release();
    // Exactly one more, after it, for both.
    expect(source.pending()).toBe(1);
    await source.release();
    await waitFor(() => expect(rowIds()).toHaveLength(2));
    await settle();
    expect(source.listCollectionResources).toHaveBeenCalledTimes(2);
  });

  it("does not show loading over its rows while it reads them again", async () => {
    await mountLive([card("t-1", "pending")]);
    hear(boardNotice());
    expect(document.querySelector('[data-state="loading"]')).toBeNull();
    expect(rowIds()).toEqual(["t-1"]);
  });

  it("closes its subscription on unmount, and on a new board discards the old board's read (BR-18)", async () => {
    const source = heldSource([card("t-1", "pending")]);
    const props = { sessionId: SESSION, client: hostClient(source), live: true } as const;
    const view = render(createElement(BoardList, { ...props, boardRef: BOARD }));
    const first = subscriptions[0]!;
    // The old board's read is still open when the board changes.
    view.rerender(createElement(BoardList, { ...props, boardRef: "eng.feature.backlog" }));
    expect(first.closed).toBe(true);
    const open = subscriptions.filter((s) => !s.closed);
    expect(open.map((s) => s.topics)).toEqual([[{ scope: "session", id: SESSION, resource: "eng.feature.backlog" }]]);
    source.setRows([card("t-2", "pending")]);
    await source.release();
    await source.release();
    await waitFor(() => expect(rowIds()).toEqual(["t-2"]));

    view.unmount();
    expect(subscriptions.every((s) => s.closed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V3 · the subscription's credential
// ---------------------------------------------------------------------------

describe("BoardList · the subscription carries the read's credential, to the read's origin (V3, BR-16)", () => {
  // The real client, against a host `fetch`: one transport for the read and
  // the subscription is the client and the list together.
  function hostFetchAnswering(rows: Listed[]) {
    const sent: Array<{ url: string; authorization: string | null }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", "Bearer host-token");
      const url = String(input);
      sent.push({ url, authorization: headers.get("authorization") });
      // A host with no push, so the client reads on its timer and the case ends quietly.
      if (url.includes("/capabilities")) return new Response(JSON.stringify({ push: null }), { status: 200 });
      return new Response(JSON.stringify({ items: rows }), { status: 200 });
    });
    return { fetcher, sent };
  }

  it("sends the read and the subscription through the host's client, header and all", async () => {
    // The plain `fetch`: anything that reaches it went out without the host's header.
    const plain = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", plain);
    const host = hostFetchAnswering([card("t-1", "pending")]);
    const client = createClient({ userId: "u1", baseUrl: "", fetcher: host.fetcher });

    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, client, live: true }));
    await waitFor(() => expect(rowIds()).toEqual(["t-1"]));
    await waitFor(() => expect(host.sent.some((s) => s.url.includes("/capabilities"))).toBe(true));
    expect(host.sent.every((s) => s.authorization === "Bearer host-token")).toBe(true);
    expect(plain).not.toHaveBeenCalled();
  });

  it("reads and subscribes through the provider's fetch when the host passes no client", async () => {
    const plain = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", plain);
    const host = hostFetchAnswering([card("t-1", "pending")]);

    render(
      createElement(FlowProvider, {
        fetcher: host.fetcher,
        children: createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, live: true })
      })
    );
    await waitFor(() => expect(rowIds()).toEqual(["t-1"]));
    await waitFor(() =>
      expect(host.sent.map((s) => new URL(s.url, window.location.href).pathname)).toEqual(
        expect.arrayContaining(["/api/flows/capabilities", `/api/flows/sessions/${SESSION}/resources/${BOARD}`])
      )
    );
    expect(plain).not.toHaveBeenCalled();
  });

  it("subscribes at the origin the host's client reads, not the provider's", async () => {
    const plain = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", plain);
    const host = hostFetchAnswering([card("t-1", "pending")]);
    const client = createClient({ userId: "u1", baseUrl: "https://boards.example", fetcher: host.fetcher });

    render(
      createElement(FlowProvider, {
        baseUrl: "https://provider.example",
        children: createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, client, live: true })
      })
    );
    await waitFor(() => expect(host.sent.some((s) => s.url.includes("/capabilities"))).toBe(true));
    expect(new Set(host.sent.map((s) => new URL(s.url).origin))).toEqual(new Set(["https://boards.example"]));
    expect(plain).not.toHaveBeenCalled();
  });
});
