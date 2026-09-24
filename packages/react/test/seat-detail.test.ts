// @vitest-environment happy-dom
/**
 * `SeatDetail` — one seat's kind and instructions (FIX-1500 S5, BR-5, BR-27, BR-29 – BR-31).
 *
 * Five states are asserted APART by `data-state`, never by trusting that some
 * text appeared: *not published* and *could not be read* look identical to a
 * test that only checks "some note rendered", and that collapse is exactly
 * the silent-partial failure BR-30/BR-31 exist to rule out (V10).
 *
 * `getCollectionItemState` is called at most once per test and its call
 * COUNT is asserted directly wherever a state promises zero reads — a
 * lingering call is invisible to every assertion on what rendered.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { SeatDetail } from "../src/components/panels/SeatDetail";

afterEach(cleanup);

/** A `getCollectionItemState` source that answers one fixed result. */
function fakeSource(result: unknown) {
  return { getCollectionItemState: vi.fn(async () => result) };
}

function pendingSource() {
  return { getCollectionItemState: vi.fn(() => new Promise<never>(() => {})) };
}

function failingSource(message: string) {
  return {
    getCollectionItemState: vi.fn(async () => {
      throw new Error(message);
    })
  };
}

describe("SeatDetail", () => {
  it("treats an empty-string seatId like no seatId at all: not published, zero reads (Cursor nit)", () => {
    const source = fakeSource({ topic: "", clientData: { seatId: "x", flow: "agent", instructions: "hi" } });
    render(createElement(SeatDetail, { sessionId: "s1", kind: "support-agent", seatId: "", resourceClient: source }));

    expect(document.querySelector('[data-state="not-published"]')).toBeTruthy();
    expect(source.getCollectionItemState).not.toHaveBeenCalled();
  });

  it("shows the kind from the prop and makes no read when no seatId is given (BR-5, BR-31)", () => {
    const source = fakeSource({ topic: "irrelevant", clientData: { seatId: "x", flow: "agent", instructions: "hi" } });
    render(createElement(SeatDetail, { sessionId: "s1", kind: "support-agent", resourceClient: source }));

    expect(screen.getByText("support-agent")).toBeTruthy();
    expect(document.querySelector('[data-state="not-published"]')).toBeTruthy();
    // Zero reads: the kind never needed one, and a seat with no roster
    // topic to look up (declared, or hired for a user) gets none either.
    expect(source.getCollectionItemState).not.toHaveBeenCalled();
  });

  it("reads through the host's own client, not the credential-less fallback (V9, BR-27)", async () => {
    // A fake transport that behaves like a deployment requiring
    // Authorization: it answers only when the host's own client is the one
    // making the request. Building the component on `useResourceCollection`,
    // or on any path that ignores the prop, reads through the fallback
    // (`createResourceClient({ baseUrl })`, no fetcher) and would 401 here.
    const source = {
      getCollectionItemState: vi.fn(async (_sessionId: string, _ref: string, topic: string) => ({
        topic,
        clientData: { seatId: topic, flow: "agent", instructions: "Answer billing questions." }
      }))
    };
    render(
      createElement(SeatDetail, {
        sessionId: "s1",
        kind: "support-agent",
        seatId: "support.ada",
        collectionRef: "roster",
        resourceClient: source
      })
    );

    await waitFor(() => expect(screen.getByText("Answer billing questions.")).toBeTruthy());
    expect(source.getCollectionItemState).toHaveBeenCalledWith("s1", "roster", "support.ada");
  });

  it("keeps the instructions text, none-given, not-published, loading and error states apart (V10)", async () => {
    // Five renders, one component, asserted by `data-state` — never by
    // "some text appeared", which is exactly what would let *not published*
    // and *could not be read* collapse into each other (BR-30, BR-31).
    const { unmount: unmountText } = render(
      createElement(SeatDetail, {
        sessionId: "s1",
        kind: "k",
        seatId: "a",
        resourceClient: fakeSource({ topic: "a", clientData: { seatId: "a", flow: "agent", instructions: "Do the thing." } })
      })
    );
    await waitFor(() => expect(document.querySelector('[data-state="text"]')).toBeTruthy());
    expect(screen.getByText("Do the thing.")).toBeTruthy();
    unmountText();

    const { unmount: unmountNone } = render(
      createElement(SeatDetail, {
        sessionId: "s1",
        kind: "k",
        seatId: "b",
        // BR-30: hired with no instructions — the key is present and null,
        // not absent.
        resourceClient: fakeSource({ topic: "b", clientData: { seatId: "b", flow: "agent", instructions: null } })
      })
    );
    await waitFor(() => expect(document.querySelector('[data-state="none"]')).toBeTruthy());
    unmountNone();

    const { unmount: unmountNotPublished } = render(
      createElement(SeatDetail, {
        sessionId: "s1",
        kind: "k",
        seatId: "c",
        // The topic is not present in the collection — `getCollectionItemState`
        // returns `null` (per its own doc comment).
        resourceClient: fakeSource(null)
      })
    );
    await waitFor(() => expect(document.querySelector('[data-state="not-published"]')).toBeTruthy());
    unmountNotPublished();

    const { unmount: unmountLoading } = render(
      createElement(SeatDetail, { sessionId: "s1", kind: "k", seatId: "d", resourceClient: pendingSource() })
    );
    await waitFor(() => expect(document.querySelector('[data-state="loading"]')).toBeTruthy());
    unmountLoading();

    render(
      createElement(SeatDetail, {
        sessionId: "s1",
        kind: "k",
        seatId: "e",
        resourceClient: failingSource("network down")
      })
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/network down/)).toBeTruthy();
    // The failure is its own render, not a disguised version of any of the
    // other four.
    expect(document.querySelector('[data-state="not-published"]')).toBeNull();
    expect(document.querySelector('[data-state="none"]')).toBeNull();
    expect(document.querySelector('[data-state="loading"]')).toBeNull();
    expect(document.querySelector('[data-state="text"]')).toBeNull();
  });

  it("treats a metadata-only item (no clientData) as could-not-be-read, not not-published (FIX-1500 bug 1)", async () => {
    // The route returns `{ topic, storageKey, hint }` — no `clientData` — when
    // the collection has no client projection configured. The item EXISTS;
    // it just can't be read through this surface. That is the distinct
    // "could not be read" state, not the "no such topic" state.
    const source = fakeSource({ topic: "f", storageKey: "roster/f", hint: "no client.data configured" });
    render(createElement(SeatDetail, { sessionId: "s1", kind: "k", seatId: "f", resourceClient: source }));

    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeTruthy());
    expect(document.querySelector('[data-state="not-published"]')).toBeNull();
  });

  it("treats a row with a non-string, non-null instructions field as could-not-be-read, not a throw (FIX-1500 bug 2)", async () => {
    // `isSeat` checks only `seatId` and `flow`. A row with `instructions: {}`
    // passes that guard, gets cast to `RosterSeat`, and would be handed to
    // React as a child — which throws trying to render an object.
    const source = fakeSource({
      topic: "g",
      clientData: { seatId: "g", flow: "agent", instructions: {} }
    });

    expect(() =>
      render(createElement(SeatDetail, { sessionId: "s1", kind: "k", seatId: "g", resourceClient: source }))
    ).not.toThrow();

    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeTruthy());
    expect(document.querySelector('[data-state="not-published"]')).toBeNull();
    expect(document.querySelector('[data-state="none"]')).toBeNull();
    expect(document.querySelector('[data-state="text"]')).toBeNull();
  });

  it(
    "shows a user-owned seat as not published and makes zero reads, even when its short id " +
      "matches an org-visible seat (V17, BR-31)",
    () => {
      // If the caller (or this component) hand-split a user-owned address
      // `<org>.~<user>.<id>` down to its trailing id and read with THAT, this
      // source would happily answer with the OTHER, org-visible seat's row —
      // the collision this check exists to catch. `SeatDetail` never sees
      // that address at all here: the host passes no `seatId` for a
      // user-owned seat (see the file header's "Reuse" note), so there is no
      // split to get wrong and no call for this source to answer.
      const collidingShortId = "ada";
      const source = fakeSource({
        topic: collidingShortId,
        clientData: { seatId: collidingShortId, flow: "agent", instructions: "The other org-visible seat's own instructions." }
      });
      render(createElement(SeatDetail, { sessionId: "s1", kind: "support-agent", resourceClient: source }));

      expect(document.querySelector('[data-state="not-published"]')).toBeTruthy();
      expect(screen.queryByText(/other org-visible seat/)).toBeNull();
      expect(source.getCollectionItemState).not.toHaveBeenCalled();
    }
  );
});
