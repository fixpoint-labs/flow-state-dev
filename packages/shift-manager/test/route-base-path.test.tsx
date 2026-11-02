// @vitest-environment happy-dom
/**
 * Served on a proxy's sub-route (`apps/super-app` puts Shift Manager at
 * `/shift-manager/`, its `<base href>` rewritten to match), every address stays
 * under that prefix: a link's `href`, the history entry a click writes, and the
 * route read back from the address. Without this, the first click would leave
 * the sub-route and land on another app.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RouteLink } from "../src/components/RouteLink";
import { useRoute } from "../src/lib/routes";

function serveAt(base: string | null) {
  document.head.querySelector("base")?.remove();
  if (base === null) return;
  const element = document.createElement("base");
  element.setAttribute("href", base);
  document.head.prepend(element);
}

afterEach(() => {
  cleanup();
  serveAt(null);
});

describe("Shift Manager under a sub-route", () => {
  beforeEach(() => {
    serveAt("/shift-manager/");
    window.history.pushState(null, "", "/shift-manager/inbox");
  });

  it("reads the route from the address below the prefix", () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ level: "inbox", item: null });
  });

  it("links and navigates under the prefix", () => {
    render(
      <RouteLink to={{ level: "roster", team: null }} data-testid="link">
        Roster
      </RouteLink>,
    );
    const link = screen.getByTestId("link");
    expect(link.getAttribute("href")).toBe("/shift-manager/roster");
    act(() => void fireEvent.click(link));
    expect(window.location.pathname).toBe("/shift-manager/roster");
  });
});

describe("Shift Manager at the root of its origin", () => {
  it("keeps root addresses with the `<base href=\"/\">` its page ships with", () => {
    serveAt("/");
    window.history.pushState(null, "", "/messages");
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ level: "messages" });
    render(<RouteLink to={{ level: "usage" }} data-testid="link">Usage</RouteLink>);
    expect(screen.getByTestId("link").getAttribute("href")).toBe("/usage");
  });
});
