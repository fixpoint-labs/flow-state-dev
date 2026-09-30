// @vitest-environment happy-dom
/**
 * `BoardList`: one board as a list with each task's status (FIX-1622 V1), and
 * its `live` re-read (V2, V3).
 *
 * The stream is faked at the client seam, so each live case hands the list
 * exactly the events it would get and counts the board reads it makes. Reads
 * are counted rather than only the rows asserted, because a list that polls,
 * or re-reads on every copy the stream repeats, draws the same rows. The
 * transport cases run the real stream client against a host `fetch`, since
 * "the stream carries the read's credential, to the read's origin" is the
 * list and the client together.
 *
 * Every read the list makes is held until the case releases it, so "a change
 * that lands mid-read" is a change delivered while a read is still open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { OutputItem, SessionStreamEvent } from "@flow-state-dev/core/items";
import type { CreateSessionSSEClientOptions } from "@flow-state-dev/client";

const { streams, realStream } = vi.hoisted(() => ({
  streams: [] as Array<{ options: CreateSessionSSEClientOptions; closed: boolean }>,
  realStream: { on: false }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  return {
    ...actual,
    createSessionSSEClient: (options: CreateSessionSSEClientOptions) => {
      if (realStream.on) return actual.createSessionSSEClient(options);
      const entry = { options, closed: false };
      streams.push(entry);
      return {
        close: () => {
          entry.closed = true;
        },
        lastAt: undefined,
        stopped: false
      };
    }
  };
});

import { BoardList, boardListPropNames } from "../src/components/panels/BoardList";
import { FlowProvider } from "../src/context/FlowContext";

const BOARD = "eng.feature.triage";
const SESSION = "s1";

type Row = { topic: string; clientData: unknown };

const card = (id: string, status: string, extra: Record<string, unknown> = {}): Row => ({
  topic: id,
  clientData: { id, status, ...extra }
});

/**
 * A board source whose every read stays open until the case releases it, and
 * which answers with whatever rows the board holds at that moment.
 */
function heldSource(initial: Row[]) {
  let rows = initial;
  const open: Array<() => void> = [];
  const listCollectionItems = vi.fn(
    () =>
      new Promise<{ items: Row[] }>((resolve) => {
        open.push(() => resolve({ items: rows }));
      })
  );
  return {
    listCollectionItems,
    setRows: (next: Row[]) => {
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
function fixedSource(items: Row[]) {
  return { listCollectionItems: vi.fn(async () => ({ items })) };
}

function openStream() {
  const open = streams.filter((s) => !s.closed);
  const last = open[open.length - 1];
  if (last === undefined) throw new Error("no open session stream");
  return last.options;
}

function deliver(event: SessionStreamEvent): void {
  const options = openStream();
  act(() => {
    if (event.type === "session.item") options.onItem?.(event);
    if (event.type === "session.runs") options.onRuns?.(event);
  });
}

/** The notice every connection opens with; `at` is the point its first read reaches back to. */
const opening = (at: number): SessionStreamEvent => ({
  stream: "session",
  sessionId: SESSION,
  at,
  type: "session.runs",
  runs: []
});

function component(
  requestId: string,
  id: string,
  name: string,
  data: Record<string, unknown>,
  ts: number,
  itemIndex = 0
): OutputItem {
  return {
    id,
    type: "component",
    status: "completed",
    requestId,
    itemIndex,
    ts,
    provenance: { blockName: "b", blockInstanceId: "b_1", phase: "main" },
    component: name,
    data
  } as unknown as OutputItem;
}

/** A `task-change` for `board`, carrying the whole row the way the session's item log does. */
function taskChange(requestId: string, board: string, taskId: string, ts: number, task: Record<string, unknown> = {}) {
  return component(
    requestId,
    `tc_${taskId}`,
    "task-change",
    { collectionId: board, taskId, kind: "added", task: { id: taskId, status: "pending", ...task } },
    ts
  );
}

const itemEvent = (at: number, requestId: string, item: OutputItem): SessionStreamEvent => ({
  stream: "session",
  sessionId: SESSION,
  at,
  type: "session.item",
  requestId,
  item
});

const rowIds = () => [...document.querySelectorAll("li[data-task-id]")].map((li) => li.getAttribute("data-task-id"));
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

beforeEach(() => {
  streams.length = 0;
  realStream.on = false;
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
    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, resourceClient: source }));

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
    expect(source.listCollectionItems).toHaveBeenCalledWith(SESSION, BOARD, {});
  });

  it("shows a status it does not know as its own word, and a pre-rename row as parked (BR-4)", async () => {
    render(
      createElement(BoardList, {
        sessionId: SESSION,
        boardRef: BOARD,
        resourceClient: fixedSource([card("t-1", "blocked_upstream"), card("t-2", "awaiting_review")])
      })
    );
    await waitFor(() => expect(rowIds()).toHaveLength(2));
    const status = (id: string) =>
      document.querySelector(`li[data-task-id="${id}"] [data-task-status]`)?.textContent;
    expect(status("t-1")).toBe("blocked_upstream");
    expect(status("t-2")).toBe("parked");
  });

  it("keeps loading, empty and a failed read apart, and offers a retry on failure (BR-6, BR-7)", async () => {
    const pending = { listCollectionItems: vi.fn(() => new Promise<never>(() => {})) };
    const { unmount } = render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, resourceClient: pending }));
    expect(document.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
    unmount();

    const { unmount: unmountEmpty } = render(
      createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, resourceClient: fixedSource([]) })
    );
    await waitFor(() => expect(document.querySelector('[data-state="empty"]')).not.toBeNull());
    expect(document.querySelector('[data-state="loading"]')).toBeNull();
    unmountEmpty();

    let fail = true;
    const flaky = {
      listCollectionItems: vi.fn(async () => {
        if (fail) throw new Error("board unavailable");
        return { items: [card("t-1", "pending")] };
      })
    };
    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, resourceClient: flaky }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("board unavailable"));
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
    // Nothing retries by itself.
    await settle();
    expect(flaky.listCollectionItems).toHaveBeenCalledTimes(1);
    fail = false;
    await act(async () => screen.getByRole("button", { name: "Retry" }).click());
    await waitFor(() => expect(rowIds()).toEqual(["t-1"]));
  });

  it("errors rather than draw a partial list when the board never stops paging (FIX-1577)", async () => {
    // A transport that hands back a `nextCursor` forever, one row per page.
    let n = 0;
    const endless = {
      listCollectionItems: vi.fn(async () => {
        const row = card(`t-${n++}`, "pending");
        return { items: [row], nextCursor: row.topic };
      })
    };
    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, resourceClient: endless }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/more still to read/));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(rowIds()).toEqual([]);
    // Stops at the ceiling rather than reading forever.
    expect(endless.listCollectionItems).toHaveBeenCalledTimes(1000);
  });

  it("wraps a host's row body in the list's own row, and says what a host's empty slot says", async () => {
    render(
      createElement(BoardList, {
        sessionId: SESSION,
        boardRef: BOARD,
        resourceClient: fixedSource([card("t-1", "pending", { title: "Charger fire" })]),
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
        resourceClient: fixedSource([]),
        slots: { empty: () => createElement("p", { "data-host-empty": "" }, "Nobody needs a person.") }
      })
    );
    await waitFor(() => expect(document.querySelector("[data-host-empty]")?.textContent).toBe("Nobody needs a person."));
  });

  it("publishes the props it takes, and no organization filter", () => {
    expect([...boardListPropNames]).toEqual([
      "baseUrl",
      "boardRef",
      "fetcher",
      "limit",
      "live",
      "resourceClient",
      "sessionId",
      "slots"
    ]);
  });
});

// ---------------------------------------------------------------------------
// V2 · live
// ---------------------------------------------------------------------------

describe("BoardList · live (V2)", () => {
  function renderLive(source: ReturnType<typeof heldSource>) {
    return render(
      createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, resourceClient: source, fetcher: vi.fn(), live: true })
    );
  }

  /**
   * Mount a live list, connect its stream with an opening scan that finds
   * nothing for this board, and let the mount read land. Hands back the
   * source at one read.
   */
  async function mountLive(rows: Row[] = [card("t-1", "pending")]) {
    const source = heldSource(rows);
    const view = renderLive(source);
    deliver(opening(100));
    await source.release();
    await waitFor(() => expect(rowIds()).toHaveLength(rows.length));
    expect(source.listCollectionItems).toHaveBeenCalledTimes(1);
    return { source, view };
  }

  it("without live, opens no stream and reads once (BR-17)", async () => {
    const source = fixedSource([card("t-1", "pending")]);
    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, resourceClient: source }));
    await waitFor(() => expect(rowIds()).toEqual(["t-1"]));
    await settle();
    expect(streams).toHaveLength(0);
    expect(source.listCollectionItems).toHaveBeenCalledTimes(1);
  });

  it("opens the session's stream, components only, before its first read", async () => {
    const opened: string[] = [];
    const source = heldSource([]);
    source.listCollectionItems.mockImplementationOnce(() => {
      opened.push(streams.length === 1 ? "read after the stream" : "read before the stream");
      return new Promise(() => {});
    });
    renderLive(source);
    expect(opened).toEqual(["read after the stream"]);
    expect(streams[0]!.options).toMatchObject({ sessionId: SESSION, itemTypes: ["component"] });
    // No `since`: the first connection reaches back a minute.
    expect(streams[0]!.options.since).toBeUndefined();
  });

  it("reads once, on mount, when the opening scan finds nothing for this board", async () => {
    const source = heldSource([card("t-1", "pending")]);
    renderLive(source);
    deliver(opening(100));
    // The scan finds another board's change, and a component on this board
    // that is not a task change.
    deliver(itemEvent(100, "req_a", taskChange("req_a", "eng.feature.backlog", "t-9", Date.now())));
    deliver(itemEvent(100, "req_a", component("req_a", "cp_1", "note", { body: "hello", collectionId: BOARD }, Date.now())));
    await source.release();
    // A later notice on the same connection says the runs changed, not the board.
    deliver(opening(1_100));
    await settle();
    expect(source.pending()).toBe(0);
    expect(source.listCollectionItems).toHaveBeenCalledTimes(1);
  });

  it("reads once more when the opening scan finds changes to this board, however many", async () => {
    const source = heldSource([card("t-1", "pending"), card("t-2", "pending")]);
    renderLive(source);
    deliver(opening(100));
    // Changes from 30 s ago and from just now, heard while the mount read is open.
    deliver(itemEvent(100, "req_a", taskChange("req_a", BOARD, "t-1", Date.now() - 30_000)));
    deliver(itemEvent(100, "req_b", taskChange("req_b", BOARD, "t-2", Date.now())));
    expect(source.pending()).toBe(1);
    await source.release();
    expect(source.pending()).toBe(1);
    await source.release();
    await settle();
    expect(source.pending()).toBe(0);
    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);
  });

  it("shows a change kept after the mount read that the stream delivers only in its opening scan", async () => {
    const source = heldSource([]);
    renderLive(source);
    deliver(opening(100));
    // Every read the list has asked for so far lands before the change is kept.
    while (source.pending() > 0) await source.release();
    source.setRows([card("t-new", "pending")]);
    // The server named the runs, then began its first scan, which finds the
    // change: it arrives as part of that opening scan and nowhere else.
    deliver(itemEvent(100, "req_file", taskChange("req_file", BOARD, "t-new", Date.now())));
    await settle();
    expect(source.pending()).toBe(1);
    await source.release();
    await waitFor(() => expect(rowIds()).toEqual(["t-new"]));
  });

  it("shows a change kept during its mount read with the page's clock 10 s ahead of the server's", async () => {
    const source = heldSource([]);
    renderLive(source);
    // The stream connects while the mount read is still open.
    deliver(opening(100));
    // The mount read reached the store just before the change was kept.
    await source.release();
    source.setRows([card("t-new", "pending")]);
    // The stream's first read finds the change, stamped by the server's clock,
    // 10 s behind this page's.
    deliver(itemEvent(100, "req_file", taskChange("req_file", BOARD, "t-new", Date.now() - 10_000)));
    await settle();
    expect(source.pending()).toBe(1);
    await source.release();
    await waitFor(() => expect(rowIds()).toEqual(["t-new"]));
    await settle();
    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);
  });

  it("reads nothing when a reconnect replays what the opening scan found (BR-12)", async () => {
    const source = heldSource([card("t-1", "pending")]);
    renderLive(source);
    deliver(opening(100));
    const found = itemEvent(100, "req_a", taskChange("req_a", BOARD, "t-1", Date.now()));
    deliver(found);
    await source.release();
    await source.release();
    await settle();
    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);

    // The connection drops; the next one's opening scan delivers the same change.
    act(() => openStream().onReconnecting?.({ attempt: 1 }));
    deliver(opening(1_100));
    deliver({ ...found, at: 1_100 });
    await settle();
    expect(source.pending()).toBe(0);
    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);
  });

  it("reads the board again on a change to it, and draws the read, never the change (BR-8, BR-9)", async () => {
    const { source } = await mountLive([card("t-1", "pending", { title: "Charger fire" })]);
    // The change says `completed` and carries fields the board withholds; the read says `pending`.
    deliver(itemEvent(200, "req_1", taskChange("req_1", BOARD, "t-1", Date.now(), { status: "completed", metadata: { author: "x" } })));
    expect(source.pending()).toBe(1);
    await source.release();

    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);
    expect(document.querySelector('li[data-task-id="t-1"] [data-task-status]')?.textContent).toBe("pending");
    expect(document.body.textContent).not.toContain("completed");
    expect(document.body.textContent).not.toContain("author");
  });

  it("reads nothing for another board's change, another kind of component, or an item that is not a component (BR-10)", async () => {
    const { source } = await mountLive();
    deliver(itemEvent(200, "req_1", taskChange("req_1", "eng.feature.backlog", "t-9", Date.now())));
    deliver(itemEvent(200, "req_1", component("req_1", "cp_1", "note", { body: "hello", collectionId: BOARD }, Date.now())));
    deliver(
      itemEvent(200, "req_1", {
        ...(taskChange("req_1", BOARD, "t-8", Date.now()) as unknown as Record<string, unknown>),
        type: "message"
      } as unknown as OutputItem)
    );
    await settle();
    expect(source.listCollectionItems).toHaveBeenCalledTimes(1);
  });

  it("reads at most once more for a burst, with one read in flight and one queued (BR-11)", async () => {
    const { source } = await mountLive();
    for (const n of [1, 2, 3, 4, 5]) {
      deliver(itemEvent(200, `req_${n}`, taskChange(`req_${n}`, BOARD, `t-${n}`, Date.now())));
    }
    // One in flight, and the other four queued as one.
    expect(source.pending()).toBe(1);
    await source.release();
    expect(source.pending()).toBe(1);
    await source.release();
    await settle();
    expect(source.pending()).toBe(0);
    expect(source.listCollectionItems).toHaveBeenCalledTimes(3);
  });

  it("reads a change that lands while the mount read pages in exactly one read after it", async () => {
    const source = heldSource([]);
    renderLive(source);
    deliver(opening(100));
    // Kept while the mount read is still open: that read may or may not hold it.
    deliver(itemEvent(1_200, "req_file", taskChange("req_file", BOARD, "t-new", Date.now())));
    deliver(itemEvent(1_200, "req_more", taskChange("req_more", BOARD, "t-more", Date.now())));
    source.setRows([card("t-new", "pending"), card("t-more", "pending")]);
    expect(source.pending()).toBe(1);
    await source.release();
    // Exactly one more, after it, for both.
    expect(source.pending()).toBe(1);
    await source.release();
    await waitFor(() => expect(rowIds()).toHaveLength(2));
    await settle();
    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);
  });

  it("reads nothing for a copy the stream repeats across a reconnect, and reads a change kept during the drop (BR-12, BR-14)", async () => {
    const { source } = await mountLive();
    const filed = taskChange("req_1", BOARD, "t-1", Date.now());
    deliver(itemEvent(1_100, "req_1", filed));
    await source.release();
    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);

    // The connection drops; the next one resumes a little before where it
    // left off, and its notice reads nothing.
    act(() => openStream().onReconnecting?.({ attempt: 1 }));
    deliver(opening(1_100));
    deliver(itemEvent(1_100, "req_1", filed));
    await settle();
    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);

    // Kept while the stream was down: new to the list, so it reads.
    deliver(itemEvent(1_100, "req_2", taskChange("req_2", BOARD, "t-2", Date.now() - 20_000)));
    expect(source.pending()).toBe(1);
    await source.release();
    expect(source.listCollectionItems).toHaveBeenCalledTimes(3);
  });

  it("reads for a later copy of the same keyed change, stamped after the one it heard", async () => {
    const { source } = await mountLive();
    const ts = Date.now();
    deliver(itemEvent(1_100, "req_1", taskChange("req_1", BOARD, "t-1", ts)));
    await source.release();
    deliver(itemEvent(2_100, "req_1", { ...(taskChange("req_1", BOARD, "t-1", ts + 5) as object), itemIndex: 3 } as OutputItem));
    expect(source.pending()).toBe(1);
  });

  it("keeps its rows and says nothing when the stream is refused, and reads nothing more (BR-15)", async () => {
    for (const status of [401, 404, 501]) {
      streams.length = 0;
      const source = heldSource([card("t-1", "pending")]);
      renderLive(source);
      await source.release();
      await waitFor(() => expect(rowIds()).toEqual(["t-1"]));
      act(() => openStream().onStop?.({ status }));
      await settle();
      expect(rowIds()).toEqual(["t-1"]);
      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(source.listCollectionItems).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("does not show loading over its rows while it reads them again", async () => {
    const { source } = await mountLive([card("t-1", "pending")]);
    deliver(itemEvent(1_100, "req_1", taskChange("req_1", BOARD, "t-2", Date.now())));
    expect(source.pending()).toBe(1);
    expect(document.querySelector('[data-state="loading"]')).toBeNull();
    expect(rowIds()).toEqual(["t-1"]);
  });

  it("closes its stream on unmount, and on a new board discards the old board's read (BR-18)", async () => {
    const source = heldSource([card("t-1", "pending")]);
    const props = { sessionId: SESSION, resourceClient: source, fetcher: vi.fn(), live: true } as const;
    const view = render(createElement(BoardList, { ...props, boardRef: BOARD }));
    const first = streams[0]!;
    // The old board's read is still open when the board changes.
    view.rerender(createElement(BoardList, { ...props, boardRef: "eng.feature.backlog" }));
    expect(first.closed).toBe(true);
    expect(streams.filter((s) => !s.closed)).toHaveLength(1);
    source.setRows([card("t-2", "pending")]);
    await source.release();
    await source.release();
    await waitFor(() => expect(rowIds()).toEqual(["t-2"]));

    view.unmount();
    expect(streams.every((s) => s.closed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V3 · the stream's credential
// ---------------------------------------------------------------------------

describe("BoardList · the stream carries the read's credential, to the read's origin (V3, BR-16)", () => {
  it("sends the stream through the host's fetch, header and all", async () => {
    realStream.on = true;
    // The plain `fetch`: anything that reaches it went out without the host's header.
    const plain = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", plain);
    const sent: Array<{ url: string; authorization: string | null }> = [];
    const hostFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", "Bearer host-token");
      sent.push({ url: String(input), authorization: headers.get("authorization") });
      // Refused for good, so the client stops and the case ends quietly.
      return new Response(null, { status: 404 });
    });

    render(
      createElement(BoardList, {
        sessionId: SESSION,
        boardRef: BOARD,
        resourceClient: fixedSource([card("t-1", "pending")]),
        fetcher: hostFetch,
        live: true
      })
    );
    await waitFor(() => expect(sent.some((s) => s.url.includes(`/sessions/${SESSION}/stream`))).toBe(true));
    const stream = sent.find((s) => s.url.includes(`/sessions/${SESSION}/stream`))!;
    expect(stream.authorization).toBe("Bearer host-token");
    expect(plain).not.toHaveBeenCalled();
  });

  it("reads through the same fetch when the host passes no client of its own", async () => {
    realStream.on = true;
    const plain = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", plain);
    const paths: string[] = [];
    const hostFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      paths.push(new URL(url, "http://host").pathname);
      if (url.includes("/stream")) return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ items: [card("t-1", "pending")] }), { status: 200 });
    });

    render(createElement(BoardList, { sessionId: SESSION, boardRef: BOARD, fetcher: hostFetch, live: true }));
    await waitFor(() => expect(rowIds()).toEqual(["t-1"]));
    expect(paths).toEqual(
      expect.arrayContaining([`/api/flows/sessions/${SESSION}/stream`, `/api/flows/sessions/${SESSION}/resources/${BOARD}`])
    );
    expect(plain).not.toHaveBeenCalled();
  });

  it("sends the stream to the origin the host's client reads, not the provider's", async () => {
    realStream.on = true;
    const plain = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", plain);
    const urls: string[] = [];
    const hostFetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(null, { status: 404 });
    });

    render(
      createElement(
        FlowProvider,
        { baseUrl: "https://provider.example" },
        createElement(BoardList, {
          sessionId: SESSION,
          boardRef: BOARD,
          resourceClient: fixedSource([card("t-1", "pending")]),
          fetcher: hostFetch,
          baseUrl: "https://boards.example",
          live: true
        })
      )
    );
    await waitFor(() => expect(urls.some((url) => url.includes("/stream"))).toBe(true));
    const stream = new URL(urls.find((url) => url.includes("/stream"))!);
    expect(stream.origin).toBe("https://boards.example");
    expect(stream.pathname).toBe(`/api/flows/sessions/${SESSION}/stream`);
    expect(plain).not.toHaveBeenCalled();
  });

  it("reads from that origin too when the host passes no client of its own", async () => {
    realStream.on = true;
    const plain = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", plain);
    const origins = new Set<string>();
    const hostFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      origins.add(new URL(url).origin);
      if (url.includes("/stream")) return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ items: [card("t-1", "pending")] }), { status: 200 });
    });

    render(
      createElement(
        FlowProvider,
        { baseUrl: "https://provider.example" },
        createElement(BoardList, {
          sessionId: SESSION,
          boardRef: BOARD,
          fetcher: hostFetch,
          baseUrl: "https://boards.example",
          live: true
        })
      )
    );
    await waitFor(() => expect(rowIds()).toEqual(["t-1"]));
    await waitFor(() => expect(hostFetch).toHaveBeenCalledTimes(2));
    expect([...origins]).toEqual(["https://boards.example"]);
    expect(plain).not.toHaveBeenCalled();
  });
});
