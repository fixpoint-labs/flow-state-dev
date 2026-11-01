// @vitest-environment happy-dom
/**
 * A route link is a real `<a href>` (FIX-2414): a plain click goes there in
 * this tab without a reload, and a click the browser owns (a modifier key, the
 * middle button, another target) is left to it, so the address opens in a new
 * tab and the page doesn't move.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RouteLink } from "../src/components/RouteLink";

/**
 * Whether the last click reached the browser unhandled. Happy DOM follows an
 * unhandled link in this window; a browser would open a new tab for these
 * clicks, so the stand-in records it and stops there.
 */
let leftToBrowser: boolean | undefined;
const browser = (event: Event) => {
  leftToBrowser = !event.defaultPrevented;
  event.preventDefault();
};
beforeEach(() => {
  window.history.pushState(null, "", "/inbox");
  leftToBrowser = undefined;
  document.addEventListener("click", browser);
});
afterEach(() => {
  document.removeEventListener("click", browser);
  cleanup();
});

function draw(props: { target?: string; onNavigate?: () => void } = {}) {
  render(
    <RouteLink to={{ level: "task", boardRef: "b/1", taskId: "T-1", tab: "diff" }} data-testid="link" {...props}>
      Open
    </RouteLink>,
  );
  return screen.getByTestId("link");
}

describe("RouteLink", () => {
  it("carries the route's address, so it can be copied and opened elsewhere", () => {
    expect(draw().getAttribute("href")).toBe("/tasks/b%2F1/T-1/diff");
  });

  it("goes there in this tab on a plain click, and says it did", () => {
    let navigated = 0;
    const link = draw({ onNavigate: () => void navigated++ });
    act(() => void fireEvent.click(link));
    // Handled here: the browser's own navigation, a reload, is stopped.
    expect(leftToBrowser).toBe(false);
    expect(window.location.pathname).toBe("/tasks/b%2F1/T-1/diff");
    expect(navigated).toBe(1);
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["the middle button", { button: 1 }],
  ])("leaves a click with %s to the browser", (_name, init) => {
    let navigated = 0;
    const link = draw({ onNavigate: () => void navigated++ });
    act(() => void fireEvent.click(link, init));
    expect(leftToBrowser).toBe(true);
    expect(window.location.pathname).toBe("/inbox");
    expect(navigated).toBe(0);
  });

  it("leaves a link with another target to the browser", () => {
    const link = draw({ target: "_blank" });
    act(() => void fireEvent.click(link));
    expect(leftToBrowser).toBe(true);
    expect(window.location.pathname).toBe("/inbox");
  });
});
