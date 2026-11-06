// @vitest-environment happy-dom
/**
 * A clamped text offers *Show more* exactly when its words are cut. The
 * columns around it resize without rendering it (a dragged edge, a collapse),
 * so the offer follows the box's size and not only its renders: a message that
 * fit can be cut a moment later, and must not lose its only way to open.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Clamp } from "../src/components/Clamp";

let scrollHeight = 100;
let onResize: (() => void) | undefined;

beforeEach(() => {
  scrollHeight = 100;
  onResize = undefined;
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => scrollHeight);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Clamp", () => {
  it("offers Show more when the box resizes and the words no longer fit", () => {
    render(<Clamp>words</Clamp>);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    // The window narrows: the text rewraps taller than its clamp, with no render to say so.
    scrollHeight = 240;
    act(() => onResize?.());
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  });

  it("drops the offer when the box grows and the words fit again", () => {
    scrollHeight = 240;
    render(<Clamp>words</Clamp>);
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
    scrollHeight = 100;
    act(() => onResize?.());
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});
