import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFocusRevalidate } from "../src/react/hooks/use-focus-revalidate";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function fireVisibilityChange() {
  document.dispatchEvent(new Event("visibilitychange"));
}

function fireFocus() {
  window.dispatchEvent(new Event("focus"));
}

describe("useFocusRevalidate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("fires on visibilitychange when the page is visible", () => {
    const cb = vi.fn();
    renderHook(() => useFocusRevalidate(cb));
    fireVisibilityChange();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("fires on window focus", () => {
    const cb = vi.fn();
    renderHook(() => useFocusRevalidate(cb));
    fireFocus();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("fires on the first event even immediately after mount", () => {
    // Guards against seeding the throttle ref to Date.now(), which would
    // swallow a focus event landing within throttleMs of mount.
    const cb = vi.fn();
    renderHook(() => useFocusRevalidate(cb, { throttleMs: 5000 }));
    fireFocus();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("collapses a same-gesture visibilitychange + focus pair into one call", () => {
    const cb = vi.fn();
    renderHook(() => useFocusRevalidate(cb));
    fireVisibilityChange();
    fireFocus();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire while the page is hidden", () => {
    const cb = vi.fn();
    renderHook(() => useFocusRevalidate(cb));
    setVisibility("hidden");
    fireVisibilityChange();
    fireFocus();
    expect(cb).not.toHaveBeenCalled();
  });

  it("throttles repeat events within the window, then fires again once it elapses", () => {
    const cb = vi.fn();
    renderHook(() => useFocusRevalidate(cb, { throttleMs: 5000 }));

    fireFocus();
    expect(cb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000);
    fireFocus();
    expect(cb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    fireFocus();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not attach listeners when disabled", () => {
    const cb = vi.fn();
    renderHook(() => useFocusRevalidate(cb, { enabled: false }));
    fireFocus();
    fireVisibilityChange();
    expect(cb).not.toHaveBeenCalled();
  });

  it("removes listeners on unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useFocusRevalidate(cb));
    unmount();
    fireFocus();
    expect(cb).not.toHaveBeenCalled();
  });
});
