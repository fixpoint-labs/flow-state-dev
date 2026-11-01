// @vitest-environment happy-dom
/**
 * What is open survives a reload, a link and Back. A reload here is the app
 * drawn afresh on the same lab with nothing but the page's address: every
 * case asserts on what is drawn, never on the address alone, so an app that
 * writes the address and ignores it on load fails.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import type { LabAdapter } from "../src/adapter";
import { createFakeLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const thread = () => screen.getByRole("main", { name: "Main thread" });
const sessionsList = () => screen.getByRole("navigation", { name: "Sessions" });
const tab = (name: string) => within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name });
const params = () => new URLSearchParams(window.location.search);

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session");
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

async function pick(name = "vendor-notes") {
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name }));
  await screen.findByLabelText("Message the main session");
}

/** The app drawn afresh on the same lab, as a reload draws it: only the address carries over. */
function reload(adapter: LabAdapter) {
  cleanup();
  render(<App adapter={adapter} />);
}

/** Back, as the browser does it: the address moves, then `popstate` fires. */
async function back() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("the page's address", () => {
  it("reopens the session and the task sheet that were open, after a reload", async () => {
    const adapter = createFakeLab({ speed: 0.01 });
    render(<App adapter={adapter} />);
    await pick();
    await ask("Compare Acme and Globex for us.");
    const pane = () => screen.getByRole("complementary", { name: "Background tasks" });
    await waitFor(() => expect(within(pane()).getByRole("button", { name: /Research Globex/ })).toBeTruthy());
    fireEvent.click(within(pane()).getByRole("button", { name: /Research Globex/ }));
    expect(screen.getByRole("dialog", { name: "Work: Research Globex" })).toBeTruthy();

    reload(adapter);
    expect(await screen.findByRole("dialog", { name: "Work: Research Globex" })).toBeTruthy();
    expect(within(thread()).getAllByText(/Compare Acme and Globex for us\./).length).toBeGreaterThan(0);
  });

  it("reopens the Projects view, its session and the thread open on the board, after a reload", async () => {
    const adapter = createFakeLab({ speed: 0.01 });
    render(<App adapter={adapter} />);
    fireEvent.click(tab("Projects"));
    await pick();
    await ask("Research three vendors for a status page, one thread each.");
    const card = await within(thread()).findByRole("region", { name: "Task: Vendor B · regions" });
    await waitFor(() => expect(within(card).getByRole("button", { name: /View thread|Answer/ })).toBeTruthy());
    fireEvent.click(within(card).getByRole("button", { name: /View thread|Answer/ }));
    expect(screen.getByRole("complementary", { name: "Task: Vendor B · regions" })).toBeTruthy();

    reload(adapter);
    expect(await screen.findByRole("complementary", { name: "Task: Vendor B · regions" })).toBeTruthy();
    expect(tab("Projects").getAttribute("aria-selected")).toBe("true");
    expect(within(thread()).getAllByText(/Research three vendors/).length).toBeGreaterThan(0);
  });

  it("keeps the Projects view on New session across a reload", async () => {
    const adapter = createFakeLab({ speed: 0.01 });
    render(<App adapter={adapter} />);
    fireEvent.click(tab("Projects"));
    reload(adapter);
    expect(tab("Projects").getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("region", { name: "Choose a project" })).toBeTruthy();
  });

  it("goes Back to the session that was open before New session", async () => {
    render(<App adapter={createFakeLab({ speed: 0.01 })} />);
    await pick();
    await ask("First session's line.");
    fireEvent.click(within(sessionsList()).getByRole("button", { name: "+ New session" }));
    expect(await screen.findByRole("region", { name: "Choose a project" })).toBeTruthy();

    await back();
    expect((await within(thread()).findAllByText(/First session's line\./)).length).toBeGreaterThan(0);
  });

  it("opens the default screen on a link whose session is gone, and drops the dead id from the address", async () => {
    window.history.replaceState(null, "", "/?session=session-gone&task=task-gone");
    render(<App adapter={createFakeLab({ speed: 0.01 })} />);
    expect(await screen.findByRole("region", { name: "Choose a project" })).toBeTruthy();
    await waitFor(() => expect(params().has("session")).toBe(false));
    expect(params().has("task")).toBe(false);
  });

  it("keeps the session but drops a task that is gone", async () => {
    const adapter = createFakeLab({ speed: 0.01 });
    render(<App adapter={adapter} />);
    await pick();
    await ask("A line to keep.");
    const session = params().get("session");
    expect(session).toBeTruthy();
    window.history.replaceState(null, "", `/?session=${session}&task=task-gone`);

    reload(adapter);
    expect((await within(thread()).findAllByText(/A line to keep\./)).length).toBeGreaterThan(0);
    await waitFor(() => expect(params().has("task")).toBe(false));
    expect(params().get("session")).toBe(session);
  });
});
