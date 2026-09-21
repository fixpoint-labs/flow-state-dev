// @vitest-environment happy-dom
/**
 * The read fence's own contract, in its new home (FIX-1477 S3).
 *
 * `useLeafSessions`' tests cover what the fence does for one caller. These
 * cover the parts an identity-free sequence number cannot do: refusing a read
 * to a caller built for an identity that has been replaced, refusing one after
 * unmount, and — the one that is easy to lose in a rewrite — refusing it
 * WITHOUT taking a sequence number, so a retired caller cannot supersede a read
 * that is genuinely in flight.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useReadFence } from "../src/hooks/useReadFence";

const mount = () =>
  renderHook(({ id }: { id: string }) => useReadFence([id]), {
    initialProps: { id: "a" },
  });

describe("useReadFence", () => {
  it("matches a fresh array literal of the same values", () => {
    const { result } = mount();

    expect(result.current.holds(["a"])).toBe(true);
    expect(result.current.isCurrent()).toBe(true);
  });

  it("refuses a read to a caller built for an identity that has been replaced", () => {
    const { result, rerender } = mount();
    const stale = result.current;

    rerender({ id: "b" });

    expect(stale.isCurrent()).toBe(false);
    expect(stale.begin()).toBeNull();
    expect(result.current.begin()).not.toBeNull();
  });

  it("refuses without taking a sequence number, so a stale caller cannot supersede a live read", () => {
    const { result, rerender } = mount();
    const stale = result.current;
    rerender({ id: "b" });

    const live = result.current.begin();
    expect(live).not.toBeNull();

    // The staleness check runs BEFORE the sequence is claimed. Claim it first
    // and this stale caller — which has no read to make — discards the live
    // read's response instead of its own.
    expect(stale.begin()).toBeNull();

    expect(live!()).toBe(true);
  });

  it("lets the newest of two reads of ONE identity win, whichever lands last", () => {
    const { result } = mount();

    const first = result.current.begin()!;
    const second = result.current.begin()!;

    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });

  it("stops writing after unmount, which announces no superseding identity", () => {
    const { result, unmount } = mount();
    const inFlight = result.current.begin()!;

    unmount();

    expect(inFlight()).toBe(false);
    expect(result.current.begin()).toBeNull();
    expect(result.current.holds(["a"])).toBe(false);
  });

  it("clears the previous identity's state when the identity changes, and on mount", () => {
    const retired: string[] = [];
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useReadFence([id], () => retired.push(id)),
      { initialProps: { id: "a" } }
    );

    expect(retired).toEqual(["a"]);
    rerender({ id: "b" });
    expect(retired).toEqual(["a", "b"]);

    // A render that changes nothing is not an identity change.
    rerender({ id: "b" });
    expect(retired).toEqual(["a", "b"]);
  });
});
