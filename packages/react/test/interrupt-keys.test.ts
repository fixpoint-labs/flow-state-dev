/**
 * Esc is everyone's "get me out" key, so one Esc must never stop a run that
 * may be an hour of work. A stop takes a second Esc inside the window, or
 * Cmd/Ctrl+. An Esc a text field or a closing dialog already used is spent,
 * so dismissing something can never count as half of a stop.
 */
import { describe, expect, it } from "vitest";
import { createInterruptKeys, interruptChordLabel, INTERRUPT_WINDOW_MS, type InterruptKeyEvent } from "../src/interrupt-keys";

const esc = (over: Partial<InterruptKeyEvent> = {}): InterruptKeyEvent => ({ key: "Escape", metaKey: false, ctrlKey: false, ...over });

describe("createInterruptKeys", () => {
  it("never stops on a single Esc, only arms", () => {
    const keys = createInterruptKeys();
    expect(keys.press(esc(), 0)).toBe("armed");
  });

  it("stops on a second Esc inside the window, and only once", () => {
    const keys = createInterruptKeys();
    keys.press(esc(), 0);
    expect(keys.press(esc(), INTERRUPT_WINDOW_MS)).toBe("interrupt");
    expect(keys.press(esc(), INTERRUPT_WINDOW_MS + 10)).toBe("armed");
  });

  it("does not stop when the second Esc comes after the window", () => {
    const keys = createInterruptKeys({ windowMs: 1_000 });
    keys.press(esc(), 0);
    expect(keys.press(esc(), 1_001)).toBe("armed");
  });

  it("stops at once on Cmd+. and Ctrl+.", () => {
    const keys = createInterruptKeys();
    expect(keys.press({ key: ".", metaKey: true, ctrlKey: false }, 0)).toBe("interrupt");
    expect(keys.press({ key: ".", metaKey: false, ctrlKey: true }, 0)).toBe("interrupt");
    expect(keys.press({ key: ".", metaKey: false, ctrlKey: false }, 0)).toBeNull();
  });

  it("leaves an Esc in a text field to the field, and it clears an armed press", () => {
    const keys = createInterruptKeys();
    keys.press(esc(), 0);
    expect(keys.press(esc({ target: { tagName: "TEXTAREA" } as unknown as EventTarget }), 10)).toBeNull();
    expect(keys.press(esc(), 20)).toBe("armed");
    expect(keys.press(esc({ target: { tagName: "input" } as unknown as EventTarget }), 30)).toBeNull();
    expect(keys.press(esc({ target: { isContentEditable: true } as unknown as EventTarget }), 40)).toBeNull();
  });

  it("still stops on Cmd+. from a text field", () => {
    const keys = createInterruptKeys();
    expect(keys.press({ key: ".", metaKey: true, ctrlKey: false, target: { tagName: "TEXTAREA" } as unknown as EventTarget }, 0)).toBe("interrupt");
  });

  it("treats an Esc that already closed something as spent", () => {
    const keys = createInterruptKeys();
    expect(keys.press(esc({ defaultPrevented: true }), 0)).toBeNull();
    keys.press(esc(), 10);
    expect(keys.press(esc({ nativeEvent: { defaultPrevented: true } }), 20)).toBeNull();
    expect(keys.press(esc(), 30)).toBe("armed");
  });

  it("never stops on a held Esc: its auto-repeats are not second presses", () => {
    const keys = createInterruptKeys();
    expect(keys.press(esc(), 0)).toBe("armed");
    expect(keys.press(esc({ repeat: true }), 30)).toBeNull();
    expect(keys.press(esc({ repeat: true }), 60)).toBeNull();
    // A real second press still stops.
    expect(keys.press(esc(), 400)).toBe("interrupt");
  });

  it("ignores an Esc that ends an input method's composition", () => {
    const keys = createInterruptKeys();
    keys.press(esc(), 0);
    expect(keys.press(esc({ keyCode: 229 }), 10)).toBeNull();
    expect(keys.press(esc({ isComposing: true }), 20)).toBeNull();
  });
});

describe("interruptChordLabel", () => {
  it("writes the chord the way the platform does", () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    try {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" } });
      expect(interruptChordLabel()).toBe("⌘.");
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgentData: { platform: "Windows" }, userAgent: "" } });
      expect(interruptChordLabel()).toBe("Ctrl+.");
    } finally {
      if (real) Object.defineProperty(globalThis, "navigator", real);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });
});
