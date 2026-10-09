// @vitest-environment happy-dom
/**
 * The sidebar and the right panel each collapse on their own, so the centre
 * can take the window: from a control on the panel and from `[` and `]`, kept
 * for the person across reloads, and, on a narrow window, the right panel
 * opening over the centre instead of pushing it.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createLabClients } from "../src/lib/connection";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

type HappyWindow = { happyDOM: { setURL(url: string): void; setViewport(viewport: { width: number; height: number }): void } };
const happy = () => (window as unknown as HappyWindow).happyDOM;

const served: ServedLab[] = [];
beforeEach(() => {
  window.localStorage.clear();
  happy().setViewport({ width: 1600, height: 900 });
});
afterEach(async () => {
  cleanup();
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

/** Serve the ask Lab and open Shift Manager at `path`, as the `shift-manager` command serves it. */
async function openApp(path: string, userId = ASK_LAB_USER_ID) {
  const lab = await serveLab((await openAskLab()).flowState);
  served.push(lab);
  happy().setURL(`${lab.baseUrl}${path}`);
  const view = render(<App clients={createLabClients({ userId })} />);
  await screen.findByTestId("shell");
  return {
    lab,
    /** Unmount and open the page again, as a reload does: only what the browser kept carries over. */
    reload: async () => {
      view.unmount();
      render(<App clients={createLabClients({ userId })} />);
      await screen.findByTestId("shell");
    },
  };
}

/** The slot's width finishing its animation. happy-dom's TransitionEvent drops `propertyName`, so it is set here. */
const widthTransitionEnd = () => Object.defineProperty(new Event("transitionend", { bubbles: true }), "propertyName", { value: "width" });
const press = (key: string, target: Element = document.body) => act(() => void fireEvent.keyDown(target, { key }));

describe("the sidebar", () => {
  it("collapses to an icon rail whose icons still navigate and name themselves, and expands back to the full nav", async () => {
    await openApp("/inbox");
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar.getAttribute("data-collapsed")).toBe("false");
    expect(screen.getByTestId("projects")).toBeTruthy();

    act(() => fireEvent.click(screen.getByTestId("sidebar-toggle")));
    expect(sidebar.getAttribute("data-collapsed")).toBe("true");
    // The full nav is gone; the rail's icons are what's left.
    expect(screen.queryByTestId("projects")).toBeNull();
    expect(screen.queryByTestId("nav-tasks")).toBeNull();
    const tasks = screen.getByTestId("rail-tasks");
    expect(tasks.getAttribute("title")).toBe("Tasks");
    expect(tasks.getAttribute("aria-label")).toBe("Tasks");
    for (const id of ["rail-cos", "rail-inbox", "rail-roster"]) expect(screen.getByTestId(id).getAttribute("title")).toBeTruthy();

    act(() => fireEvent.click(tasks));
    expect(window.location.pathname).toBe("/tasks");
    expect(screen.getByTestId("centre").getAttribute("data-level")).toBe("tasks");
    expect(screen.getByTestId("rail-tasks").getAttribute("aria-current")).toBe("page");

    act(() => fireEvent.click(screen.getByTestId("sidebar-toggle")));
    expect(sidebar.getAttribute("data-collapsed")).toBe("false");
    expect(screen.getByTestId("projects")).toBeTruthy();
    expect(screen.queryByTestId("rail-tasks")).toBeNull();
  });
});

describe("the right panel", () => {
  it("collapses to a strip with a handle that opens it again, on its own and without touching the sidebar", async () => {
    await openApp("/cos");
    expect(screen.getByTestId("cos-panel")).toBeTruthy();
    expect(screen.queryByTestId("right-panel-rail")).toBeNull();

    act(() => fireEvent.click(screen.getByTestId("right-panel-toggle")));
    // It slides shut: the panel stays, inert, under the strip until the slot's width has animated down.
    expect(screen.getByTestId("right-panel").inert).toBe(true);
    act(() => void screen.getByTestId("right-panel-slot").dispatchEvent(widthTransitionEnd()));
    expect(screen.queryByTestId("right-panel")).toBeNull();
    expect(screen.queryByTestId("cos-panel")).toBeNull();
    const rail = screen.getByTestId("right-panel-rail");
    expect(rail.getAttribute("data-panel")).toBe("cos");
    const handle = screen.getByTestId("right-panel-toggle");
    expect(handle.getAttribute("aria-label")).toBe("Expand panel");
    expect(screen.getByTestId("sidebar").getAttribute("data-collapsed")).toBe("false");

    // Collapsing the sidebar leaves the panel collapsed, and expanding the panel leaves the sidebar collapsed.
    act(() => fireEvent.click(screen.getByTestId("sidebar-toggle")));
    expect(screen.getByTestId("right-panel-rail")).toBeTruthy();
    act(() => fireEvent.click(handle));
    expect(screen.getByTestId("cos-panel")).toBeTruthy();
    expect(screen.getByTestId("right-panel").getAttribute("data-overlay")).toBe("false");
    expect(screen.getByTestId("sidebar").getAttribute("data-collapsed")).toBe("true");
  });
});

describe("the shortcuts", () => {
  it("[ toggles the sidebar and ] the right panel, and neither does anything while the person types", async () => {
    await openApp("/cos");
    const sidebar = screen.getByTestId("sidebar");

    press("[");
    expect(sidebar.getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByTestId("cos-panel")).toBeTruthy();
    press("]");
    expect(screen.getByTestId("right-panel-rail")).toBeTruthy();
    expect(sidebar.getAttribute("data-collapsed")).toBe("true");

    // Typed into Jump to's field, both keys are characters, not toggles.
    act(() => void fireEvent.keyDown(document.body, { key: "k", metaKey: true }));
    const field = screen.getByTestId("jump-input");
    press("[", field);
    press("]", field);
    expect(sidebar.getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByTestId("right-panel-rail")).toBeTruthy();
    act(() => void fireEvent.keyDown(document.body, { key: "k", metaKey: true }));

    press("[");
    press("]");
    expect(sidebar.getAttribute("data-collapsed")).toBe("false");
    expect(screen.getByTestId("cos-panel")).toBeTruthy();

    // A held key repeats; only the first press toggles.
    act(() => void fireEvent.keyDown(document.body, { key: "[", repeat: true }));
    expect(sidebar.getAttribute("data-collapsed")).toBe("false");
  });
});

describe("a screen with no right panel", () => {
  it("leaves the panel's state alone on ], so the next screen with a panel opens as it was", async () => {
    await openApp("/inbox");
    expect(screen.queryByTestId("right-panel-slot")).toBeNull();
    press("]");
    act(() => fireEvent.click(screen.getByTestId("nav-cos")));
    expect(screen.getByTestId("cos-panel")).toBeTruthy();
  });
});

describe("what the person picked", () => {
  it("survives a reload and a change of screen, and is theirs: another user in the same browser opens with both panels expanded", async () => {
    const app = await openApp("/cos");
    act(() => fireEvent.click(screen.getByTestId("sidebar-toggle")));
    act(() => fireEvent.click(screen.getByTestId("right-panel-toggle")));

    await app.reload();
    expect(screen.getByTestId("sidebar").getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByTestId("right-panel-rail")).toBeTruthy();
    // A screen of its own carries the same picks.
    act(() => fireEvent.click(screen.getByTestId("rail-roster")));
    expect(screen.getByTestId("sidebar").getAttribute("data-collapsed")).toBe("true");

    cleanup();
    render(<App clients={createLabClients({ userId: "u_someone_else" })} />);
    await screen.findByTestId("shell");
    expect(screen.getByTestId("sidebar").getAttribute("data-collapsed")).toBe("false");
  });
});

describe("a narrow window", () => {
  it("starts the right panel collapsed, opens it over the centre without keeping that, and a wide window gets the person's pick back", async () => {
    happy().setViewport({ width: 1100, height: 900 });
    await openApp("/cos");
    // Nothing kept says collapsed, and still it starts that way.
    expect(screen.queryByTestId("cos-panel")).toBeNull();
    expect(screen.getByTestId("right-panel-rail")).toBeTruthy();

    press("]");
    expect(screen.getByTestId("cos-panel")).toBeTruthy();
    expect(screen.getByTestId("right-panel").getAttribute("data-overlay")).toBe("true");
    // Opened over the centre, the slot the centre sees stays the strip's width.
    expect(screen.getByTestId("right-panel-slot").className).toContain("w-[43px]");
    expect(window.localStorage.length).toBe(0);

    press("]");
    expect(screen.queryByTestId("cos-panel")).toBeNull();
    press("]");
    // Widened while open over the centre: the panel is the person's pick, expanded and pushing again.
    act(() => happy().setViewport({ width: 1600, height: 900 }));
    expect(screen.getByTestId("right-panel").getAttribute("data-overlay")).toBe("false");
    expect(screen.getByTestId("right-panel-slot").className).toContain("w-[340px]");
    // Narrowed again: collapsed, whatever it was before.
    act(() => happy().setViewport({ width: 1100, height: 900 }));
    expect(screen.queryByTestId("cos-panel")).toBeNull();
  });
});
