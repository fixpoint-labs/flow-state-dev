// @vitest-environment happy-dom
/**
 * Option+Left / Option+Right is "back" / "forward" in a browser when focus is
 * not in a text field, and in a harness mode it is hit by accident while the
 * page is being worked. The page leaves the session. Inside a text field the
 * same keys move by word, and must keep doing it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { useBlockHistoryKeys } from "../lib/use-block-history-keys";

afterEach(cleanup);

function Page() {
  useBlockHistoryKeys();
  return (
    <div>
      <input data-testid="field" />
      <textarea data-testid="area" />
      <div data-testid="editable" contentEditable suppressContentEditableWarning />
      <button data-testid="button">go</button>
    </div>
  );
}

function press(target: Element, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useBlockHistoryKeys", () => {
  it("stops Option+Left and Option+Right from reaching the browser's history", () => {
    const { getByTestId } = render(<Page />);
    expect(press(getByTestId("button"), { key: "ArrowLeft", altKey: true })).toBe(true);
    expect(press(document.body, { key: "ArrowRight", altKey: true })).toBe(true);
  });

  it("leaves word-by-word movement alone inside a text field", () => {
    const { getByTestId } = render(<Page />);
    for (const id of ["field", "area"]) {
      expect(press(getByTestId(id), { key: "ArrowLeft", altKey: true })).toBe(false);
    }
  });

  it("leaves other arrows alone: plain, Option+Up, and Option+Shift for selection", () => {
    const { getByTestId } = render(<Page />);
    expect(press(getByTestId("button"), { key: "ArrowLeft" })).toBe(false);
    expect(press(getByTestId("button"), { key: "ArrowUp", altKey: true })).toBe(false);
    expect(press(getByTestId("button"), { key: "ArrowLeft", altKey: true, shiftKey: true })).toBe(false);
  });

  it("stops guarding when the page goes", () => {
    const { getByTestId, unmount } = render(<Page />);
    const button = getByTestId("button");
    unmount();
    expect(press(button, { key: "ArrowLeft", altKey: true })).toBe(false);
  });
});
