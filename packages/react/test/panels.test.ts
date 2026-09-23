// @vitest-environment happy-dom
/**
 * `Roster` and `BoardColumns` behaviour (FIX-1477 BR-19 – BR-22, BR-24).
 *
 * Two of these assert on a DISTINCTION rather than on content, and those are
 * the ones worth reading twice:
 *
 *  - **An empty board is not a loading board** (BR-22). Board wiring is
 *    explicit per seat, so "nothing here yet" is an ordinary steady state and
 *    a spinner in that spot tells somebody to wait for something that is never
 *    coming. The test holds the two renders apart by their `data-state`, which
 *    is why a component that spun on an empty board would fail it — and that
 *    red state is recorded in the file header of `BoardColumns.ts`.
 *  - **No row is ever grouped into nowhere** (BR-21). A status the component
 *    does not know gets its own column, so a vocabulary that drifts costs a
 *    column's position rather than a hidden card.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import {
  BoardColumns,
  boardColumnsPropNames,
  groupIntoColumns,
  BOARD_STATUS_COLUMNS
} from "../src/components/panels/BoardColumns";
import { Roster, rosterPropNames } from "../src/components/panels/Roster";

afterEach(cleanup);

/** A collection source that answers one fixed page and counts its calls. */
function fakeSource(items: Array<{ topic: string; clientData: unknown }>) {
  return {
    listCollectionItems: vi.fn(async () => ({ items }))
  };
}

/** A source that never settles — the only honest way to hold the loading render. */
function pendingSource() {
  return { listCollectionItems: vi.fn(() => new Promise<never>(() => {})) };
}

function failingSource(message: string) {
  return {
    listCollectionItems: vi.fn(async () => {
      throw new Error(message);
    })
  };
}

/**
 * A collection source that pages, the way the real list route does: a page of
 * `pageSize`, plus `nextCursor` (the last item's own topic — opaque either
 * way) while rows remain. Lets a test seed past one page and prove the panel
 * keeps reading rather than stopping at the first response (BR-19, BR-21,
 * V11).
 */
function pagedSource(items: Array<{ topic: string; clientData: unknown }>, pageSize = 50) {
  const listCollectionItems = vi.fn(
    async (
      _sessionId: string,
      _ref: string,
      options?: { limit?: number; cursor?: string }
    ) => {
      const start =
        options?.cursor === undefined
          ? 0
          : items.findIndex((item) => item.topic === options.cursor) + 1;
      const size = options?.limit ?? pageSize;
      const page = items.slice(start, start + size);
      const hasMore = start + size < items.length;
      return { items: page, ...(hasMore ? { nextCursor: page[page.length - 1]!.topic } : {}) };
    }
  );
  return { listCollectionItems };
}

const seat = (seatId: string, flow = "agent") => ({
  topic: seatId,
  clientData: { seatId, flow, instructions: null }
});

const card = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  topic: id,
  clientData: { id, status, ...extra }
});

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

describe("Roster", () => {
  it("lists the organization's seats (BR-19)", async () => {
    const source = fakeSource([seat("support.ada"), seat("eng.bob", "coder")]);
    render(
      createElement(Roster, { sessionId: "s1", resourceClient: source, collectionRef: "roster" })
    );

    await waitFor(() => expect(screen.getByText("support.ada")).toBeTruthy());
    expect(screen.getByText("eng.bob")).toBeTruthy();
    // The read is addressed to the session and the declared ref, and nothing
    // else — there is no organization to pass, because the server already
    // resolved one.
    expect(source.listCollectionItems).toHaveBeenCalledWith("s1", "roster", {});
  });

  it("reports seats skipped at boot as a count AND a list (BR-20)", async () => {
    const source = fakeSource([seat("support.ada")]);
    render(
      createElement(Roster, {
        sessionId: "s1",
        resourceClient: source,
        problems: [
          'organization "acme", row "workforce/roster/old.zed" — no kind named "retired"'
        ]
      })
    );

    await waitFor(() => expect(screen.getByText("support.ada")).toBeTruthy());
    // Both numbers, never merged: what answers, and what was skipped. A count
    // alone would let a roster of one seat and ninety skips look healthy.
    const block = document.querySelector("[data-roster-problems]");
    expect(block?.getAttribute("data-roster-problems")).toBe("1");
    expect(screen.getByText(/no kind named "retired"/)).toBeTruthy();
    expect(document.querySelector("[data-roster-seats]")?.getAttribute("data-roster-seats")).toBe(
      "1"
    );
  });

  it("says an empty roster is empty, not loading", async () => {
    const source = fakeSource([]);
    render(createElement(Roster, { sessionId: "s1", resourceClient: source }));
    await waitFor(() =>
      expect(document.querySelector('[data-state="empty"]')).toBeTruthy()
    );
    expect(document.querySelector('[data-state="loading"]')).toBeNull();
  });

  it("surfaces a failed read with a retry, and never retries on its own", async () => {
    const source = failingSource("network down");
    render(createElement(Roster, { sessionId: "s1", resourceClient: source }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/network down/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // One read, not a timer. A region that quietly re-reads hides a broken
    // deployment behind a spinner.
    expect(source.listCollectionItems).toHaveBeenCalledTimes(1);
  });

  it("hands a slot `null` for a row written before instructions existed (BP-030)", async () => {
    // The projection copies only the keys a row HAS, so a pre-instructions row
    // arrives with the key absent, not null — verified against the real route.
    // `RosterSeat` declares `string | null`, so a consumer writing
    // `seat.instructions !== null` before touching it would throw on exactly
    // the oldest rows in the store.
    const seen: Array<string | null | undefined> = [];
    const legacyRow = { topic: "old.zed", clientData: { seatId: "old.zed", flow: "agent" } };

    render(
      createElement(Roster, {
        sessionId: "s1",
        resourceClient: fakeSource([legacyRow]),
        slots: {
          rowTrailing: (row) => {
            seen.push(row.seat.instructions);
            return null;
          }
        }
      })
    );

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    // `toBeNull` rather than a falsy check: `undefined` is falsy too, and it is
    // precisely the value this exists to rule out.
    expect(seen[0]).toBeNull();
    expect(seen[0]).not.toBeUndefined();
  });

  it("publishes no organization filter (BR-24)", () => {
    // The type test beside the component is the half that cannot be gamed;
    // this is the runtime half, so a reader sees the rule without compiling.
    expect(rosterPropNames).not.toContain("orgId");
    expect(rosterPropNames.filter((name) => /org|tenant|filter/i.test(name))).toEqual([]);
  });

  it("reads every page of the roster, not only the first (BR-19, V11)", async () => {
    // 51 rows past the route's default 50-row page (resource-routes.ts:388) —
    // a panel that reads page one and stops truncates the last seat silently.
    const seats = Array.from({ length: 51 }, (_, i) => seat(`seat-${String(i).padStart(3, "0")}`));
    const source = pagedSource(seats);
    render(createElement(Roster, { sessionId: "s1", resourceClient: source, collectionRef: "roster" }));

    await waitFor(() => expect(screen.getByText("seat-050")).toBeTruthy());
    expect(document.querySelector("[data-roster-seats]")?.getAttribute("data-roster-seats")).toBe(
      "51"
    );
    // Two requests: the first page and the one the cursor points to.
    expect(source.listCollectionItems).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// BoardColumns
// ---------------------------------------------------------------------------

describe("BoardColumns", () => {
  it("groups rows by the existing task statuses, minting none (BR-21)", async () => {
    const source = fakeSource([
      card("t1", "pending", { title: "first" }),
      card("t2", "in_progress", { title: "second" }),
      card("t3", "pending", { title: "third" })
    ]);
    render(createElement(BoardColumns, { sessionId: "s1", boardRef: "eng.feature.triage", resourceClient: source }));

    await waitFor(() => expect(document.querySelector('[data-column="pending"]')).toBeTruthy());
    // Every column the substrate has, in its order — and no extra.
    for (const status of BOARD_STATUS_COLUMNS) {
      expect(document.querySelector(`[data-column="${status}"]`), status).toBeTruthy();
    }
    expect(document.querySelectorAll("[data-column]").length).toBe(BOARD_STATUS_COLUMNS.length);
    expect(
      document.querySelectorAll('[data-column="pending"] [data-task-id]').length
    ).toBe(2);
  });

  it("lands a pre-rename row in `parked`, not a column of its own (BP-030)", async () => {
    // `awaiting_review` shipped as `parked`. The substrate maps it forward at
    // its own read boundary, but a client read does not pass through that one
    // — verified against the real route, where the legacy word comes back
    // untouched. Un-normalized, it would read as a status this version does
    // not know and earn its own column BESIDE `parked`, which is the failure
    // this asserts away.
    const source = fakeSource([card("t-legacy", "awaiting_review", { title: "old row" })]);
    render(createElement(BoardColumns, { sessionId: "s1", boardRef: "b", resourceClient: source }));

    await waitFor(() => expect(document.querySelector('[data-column="parked"]')).toBeTruthy());
    expect(
      document.querySelectorAll('[data-column="parked"] [data-task-id]').length,
      "the legacy row belongs in parked"
    ).toBe(1);
    // No stray column, and none marked unknown — either would mean the row
    // rendered somewhere a person is not looking for it.
    expect(document.querySelector('[data-column="awaiting_review"]')).toBeNull();
    expect(document.querySelector("[data-column-unknown]")).toBeNull();
    expect(document.querySelectorAll("[data-column]").length).toBe(BOARD_STATUS_COLUMNS.length);
  });

  it("gives a status it does not know its own column rather than dropping the row", () => {
    // Asserted on the grouping directly: this is where a card can be lost, and
    // a DOM assertion would pass against a component that rendered the right
    // number of columns while silently discarding the row.
    const columns = groupIntoColumns([
      { topic: "t1", card: { id: "t1", status: "pending" } },
      { topic: "t2", card: { id: "t2", status: "escalated" } }
    ]);
    const unknown = columns.find((column) => column.isUnknown);
    expect(unknown?.status).toBe("escalated");
    expect(unknown?.rows.map((row) => row.card.id)).toEqual(["t2"]);
    // Nothing is lost: every input row is in exactly one column.
    expect(columns.flatMap((column) => column.rows).length).toBe(2);
  });

  it("states the likely cause when a board is empty, and does not spin (BR-22)", async () => {
    const source = fakeSource([]);
    render(createElement(BoardColumns, { sessionId: "s1", boardRef: "b", resourceClient: source }));

    await waitFor(() => expect(document.querySelector('[data-state="empty"]')).toBeTruthy());
    // The distinction is the assertion. A component that rendered the loading
    // note for an empty board would satisfy "some text appeared" and fail here.
    expect(document.querySelector('[data-state="loading"]')).toBeNull();
    expect(screen.getByText(/nothing drains this one yet/i)).toBeTruthy();
  });

  it("does spin while the read is genuinely outstanding", async () => {
    const source = pendingSource();
    render(createElement(BoardColumns, { sessionId: "s1", boardRef: "b", resourceClient: source }));

    // The other half of the same distinction: without this, a component that
    // showed the empty note in BOTH states would pass the test above.
    await waitFor(() => expect(document.querySelector('[data-state="loading"]')).toBeTruthy());
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
  });

  it("renders one row per card whether the body is ours or the host's", async () => {
    // The column owns the `<li>`; a body is a body. Before that was true the
    // two paths disagreed — the default body carried the row's identity and a
    // custom one did not, so a host's card silently lost `data-task-id` and
    // had no way to put it back. Asserting the ROW rather than the body is
    // what makes that visible: a content-only test passes either way.
    const rows = [card("t1", "pending", { title: "first" })];

    const { unmount } = render(
      createElement(BoardColumns, {
        sessionId: "s1",
        boardRef: "b",
        resourceClient: fakeSource(rows)
      })
    );
    await waitFor(() => expect(document.querySelectorAll("[data-task-id]").length).toBe(1));
    const withDefaultBody = document.querySelectorAll("li[data-task-id]").length;
    unmount();

    render(
      createElement(BoardColumns, {
        sessionId: "s1",
        boardRef: "b",
        resourceClient: fakeSource(rows),
        slots: { card: (row) => createElement("span", null, `custom ${row.card.id}`) }
      })
    );
    await waitFor(() => expect(screen.getByText("custom t1")).toBeTruthy());

    // Same structure, same identity, both ways round.
    expect(document.querySelectorAll("li[data-task-id]").length).toBe(withDefaultBody);
    expect(document.querySelector("li[data-task-id]")?.getAttribute("data-task-id")).toBe("t1");
    // And the component never nests one row inside another.
    expect(document.querySelectorAll("li li").length).toBe(0);
  });

  it("publishes no organization filter (BR-24)", () => {
    expect(boardColumnsPropNames).not.toContain("orgId");
    expect(boardColumnsPropNames.filter((name) => /org|tenant|filter/i.test(name))).toEqual([]);
  });

  it(
    "reads every page of a board, not only the first, and renders only the " +
      "projected fields (BR-21, V11)",
    async () => {
      // 51 rows past the route's default 50-row page. Each raw row also
      // carries envelope fields the collection's `expose` withholds in
      // production and this component's type never reads — claimedBy, a
      // lease, a retry ledger, a write log — so a regression that started
      // rendering the whole envelope instead of the projection would show up
      // here too.
      const rows = Array.from({ length: 51 }, (_, i) =>
        card(`t-${String(i).padStart(3, "0")}`, "pending", {
          title: `task ${i}`,
          claimedBy: "worker-9",
          lease: { expiresAt: "2026-01-01T00:00:00Z" },
          retryLedger: [{ attempt: 1, error: "boom" }],
          writeLog: ["created", "claimed"]
        })
      );
      const source = pagedSource(rows);
      render(createElement(BoardColumns, { sessionId: "s1", boardRef: "b", resourceClient: source }));

      await waitFor(() => expect(screen.getByText("task 50")).toBeTruthy());
      expect(document.querySelectorAll('[data-column="pending"] [data-task-id]').length).toBe(51);
      expect(source.listCollectionItems).toHaveBeenCalledTimes(2);

      // None of the withheld envelope fields ever reach the DOM — only what
      // `defaultCardBody` projects (the label and, when present, `assignee`).
      const text = document.body.textContent ?? "";
      expect(text).not.toMatch(/worker-9|expiresAt|boom|write ?log/i);
    }
  );
});
