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

  it("publishes no organization filter (BR-24)", () => {
    // The type test beside the component is the half that cannot be gamed;
    // this is the runtime half, so a reader sees the rule without compiling.
    expect(rosterPropNames).not.toContain("orgId");
    expect(rosterPropNames.filter((name) => /org|tenant|filter/i.test(name))).toEqual([]);
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
});
