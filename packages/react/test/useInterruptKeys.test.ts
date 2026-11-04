// @vitest-environment happy-dom
/**
 * The hook is what both apps attach, so the gesture has to hold there, not
 * only in the pure rule: holding the first Esc a moment too long must not
 * cost the person their stop, and must never be the stop on its own.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInterruptKeys, type InterruptKeyEvent } from "../src/interrupt-keys";

afterEach(() => cleanup());

const esc = (over: Partial<InterruptKeyEvent> = {}): InterruptKeyEvent => ({ key: "Escape", metaKey: false, ctrlKey: false, ...over });

describe("useInterruptKeys", () => {
  it("keeps the first Esc armed through its auto-repeats, so the next real press stops", () => {
    const onInterrupt = vi.fn();
    const { result } = renderHook(() => useInterruptKeys({ enabled: true, onInterrupt }));
    act(() => result.current.onKeyDown(esc()));
    act(() => result.current.onKeyDown(esc({ repeat: true })));
    act(() => result.current.onKeyDown(esc({ repeat: true })));
    expect(result.current.armed).toBe(true);
    expect(onInterrupt).not.toHaveBeenCalled();
    act(() => result.current.onKeyDown(esc()));
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(result.current.armed).toBe(false);
  });

  it("still clears an armed Esc when a text field takes the next one", () => {
    const onInterrupt = vi.fn();
    const { result } = renderHook(() => useInterruptKeys({ enabled: true, onInterrupt }));
    act(() => result.current.onKeyDown(esc()));
    act(() => result.current.onKeyDown(esc({ target: { tagName: "TEXTAREA" } as unknown as EventTarget })));
    expect(result.current.armed).toBe(false);
    act(() => result.current.onKeyDown(esc()));
    expect(onInterrupt).not.toHaveBeenCalled();
  });
});
