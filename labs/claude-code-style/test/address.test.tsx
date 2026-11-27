// @vitest-environment happy-dom
/**
 * What is open survives a reload, a link and Back. A reload here is the app
 * drawn afresh on the same lab with nothing but the page's address: every
 * case asserts on what is drawn, never on the address alone, so an app that
 * writes the address and ignores it on load fails.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import { closeApps, openTestApp, vendorScripts, type TestApp } from "./app-host";

let lab: TestApp;
beforeEach(async () => {
  lab = await openTestApp({ scripts: vendorScripts().scripts });
});
afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  await closeApps();
});

/** Long enough for a read of the in-process host, which hears no push and reads on its timer. */
const SLOW = { timeout: 10_000 };

const thread = () => screen.getByRole("main", { name: "Main thread" });
const sessionsList = () => screen.getByRole("navigation", { name: "Sessions" });
const tab = (name: string) => within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name });
const params = () => new URLSearchParams(window.location.search);

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session", undefined, SLOW);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

async function pick(name = "vendor-notes") {
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name }, SLOW));
  await screen.findByLabelText("Message the main session", undefined, SLOW);
}

/** The app drawn afresh on the same lab, as a reload draws it: only the address carries over. */
function reload() {
  cleanup();
  render(lab.wrap(<App />));
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
    render(lab.wrap(<App />));
    await pick();
    await ask("Compare Acme and Globex for us.");
    const pane = () => screen.getByRole("complementary", { name: "Background tasks" });
    await waitFor(() => expect(within(pane()).getByRole("button", { name: /Research Globex/ })).toBeTruthy(), SLOW);
    fireEvent.click(within(pane()).getByRole("button", { name: /Research Globex/ }));
    expect(screen.getByRole("dialog", { name: "Work: Research Globex" })).toBeTruthy();

    reload();
    expect(await screen.findByRole("dialog", { name: "Work: Research Globex" }, SLOW)).toBeTruthy();
    expect((await within(thread()).findAllByText(/Compare Acme and Globex for us\./, undefined, SLOW)).length).toBeGreaterThan(0);
  });

  it("reopens the Projects view, its session and the thread open on the board, after a reload", async () => {
    render(lab.wrap(<App />));
    fireEvent.click(tab("Projects"));
    await pick();
    await ask("Research three vendors for a status page, one thread each.");
    const card = await within(thread()).findByRole("region", { name: "Task: Vendor B · regions" }, SLOW);
    await waitFor(() => expect(within(card).getByRole("button", { name: /View task|Answer/ })).toBeTruthy(), SLOW);
    fireEvent.click(within(card).getByRole("button", { name: /View task|Answer/ }));
    expect(screen.getByRole("dialog", { name: "Task: Vendor B · regions" })).toBeTruthy();

    reload();
    expect(await screen.findByRole("dialog", { name: "Task: Vendor B · regions" }, SLOW)).toBeTruthy();
    expect(tab("Projects").getAttribute("aria-selected")).toBe("true");
    expect((await within(thread()).findAllByText(/Research three vendors/, undefined, SLOW)).length).toBeGreaterThan(0);
  });

  it("keeps the Projects view on New session across a reload", async () => {
    render(lab.wrap(<App />));
    fireEvent.click(tab("Projects"));
    reload();
    expect(tab("Projects").getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("region", { name: "Choose a project" }, SLOW)).toBeTruthy();
  });

  it("goes Back to the session that was open before New session", async () => {
    render(lab.wrap(<App />));
    await pick();
    await ask("First session's line.");
    fireEvent.click(within(sessionsList()).getByRole("button", { name: "+ New session" }));
    expect(await screen.findByRole("region", { name: "Choose a project" }, SLOW)).toBeTruthy();

    await back();
    expect((await within(thread()).findAllByText(/First session's line\./, undefined, SLOW)).length).toBeGreaterThan(0);
  });

  it("goes Back from one session to another's open task sheet, and keeps it open", async () => {
    render(lab.wrap(<App />));
    await pick();
    await ask("Compare Acme and Globex for us.");
    const pane = () => screen.getByRole("complementary", { name: "Background tasks" });
    await waitFor(() => expect(within(pane()).getByRole("button", { name: /Research Globex/ })).toBeTruthy(), SLOW);
    fireEvent.click(within(pane()).getByRole("button", { name: /Research Globex/ }));
    expect(screen.getByRole("dialog", { name: "Work: Research Globex" })).toBeTruthy();
    fireEvent.click(within(sessionsList()).getByRole("button", { name: "+ New session" }));
    await pick();
    await ask("Second session's line.");
    // Straight from the second session to the first: the pane stays drawn across the switch.
    fireEvent.click(await within(sessionsList()).findByRole("button", { name: /Compare Acme and Globex/ }, SLOW));
    expect(await screen.findByRole("dialog", { name: "Work: Research Globex" }, SLOW)).toBeTruthy();
    fireEvent.click(await within(sessionsList()).findByRole("button", { name: /Second session's line/ }, SLOW));
    await within(thread()).findAllByText(/Second session's line\./, undefined, SLOW);

    // Back reopens the first session's sheet: its task is not judged against the second session's rows.
    await back();
    await new Promise((r) => setTimeout(r, 300));
    expect(await screen.findByRole("dialog", { name: "Work: Research Globex" }, SLOW)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog", { name: "Work: Research Globex" })).toBeTruthy();
    expect(params().get("task")).toBeTruthy();
  });

  it("names a task opened from the main thread in the address, as a pick in the pane does: Back closes it, a reload reopens it", async () => {
    render(lab.wrap(<App />));
    await pick();
    await ask("Compare Acme and Globex for us.");
    const result = await within(thread()).findByRole("region", { name: "Background result: Research Acme" }, SLOW);
    const open = await within(result).findByRole("button", { name: "Open task" }, SLOW);
    fireEvent.click(open);
    expect(screen.getByRole("dialog", { name: "Work: Research Acme" })).toBeTruthy();
    await waitFor(() => expect(params().get("task")).toBe(result.dataset.taskId));

    reload();
    expect(await screen.findByRole("dialog", { name: "Work: Research Acme" }, SLOW)).toBeTruthy();
    await back();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Work: Research Acme" })).toBeNull());
    expect(params().has("task")).toBe(false);
  });

  it("opens the default screen on a link whose session is gone, and drops the dead id from the address", async () => {
    window.history.replaceState(null, "", "/?session=session-gone&task=task-gone");
    render(lab.wrap(<App />));
    expect(await screen.findByRole("region", { name: "Choose a project" }, SLOW)).toBeTruthy();
    await waitFor(() => expect(params().has("session")).toBe(false), SLOW);
    expect(params().has("task")).toBe(false);
  });

  it("goes Back to the default screen when the session a history entry names is gone", async () => {
    render(lab.wrap(<App />));
    await pick();
    await ask("A line in a live session.");
    // An entry for a session that has since gone, then Back onto it.
    await act(async () => {
      window.history.pushState(null, "", "/?session=session-gone");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("region", { name: "Choose a project" }, SLOW)).toBeTruthy();
    await waitFor(() => expect(params().has("session")).toBe(false), SLOW);
  });

  it("keeps a view picked while the address's session is still being read", async () => {
    render(lab.wrap(<App />));
    await pick();
    await ask("A line in the addressed session.");
    await waitFor(() => expect(params().get("session")).toBeTruthy(), SLOW);
    const session = params().get("session");

    // A reload whose session list is slow, and a pick of Projects before it arrives.
    const release = lab.hold("/views/workerSessions");
    reload();
    fireEvent.click(tab("Projects"));
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(tab("Projects").getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("region", { name: "Choose a project" }, SLOW)).toBeTruthy();
    expect(params().get("view")).toBe("threads");
  });

  it("keeps the session but drops a task that is gone", async () => {
    render(lab.wrap(<App />));
    await pick();
    await ask("A line to keep.");
    // Sent: the line is in the thread before the reload.
    await within(thread()).findAllByText(/A line to keep\./, undefined, SLOW);
    await waitFor(() => expect(params().get("session")).toBeTruthy(), SLOW);
    const session = params().get("session");
    window.history.replaceState(null, "", `/?session=${session}&task=task-gone`);

    reload();
    // The center is the picker until the sessions are read, then the thread: read it afresh each time.
    await waitFor(() => expect(within(thread()).getAllByText(/A line to keep\./).length).toBeGreaterThan(0), SLOW);
    await waitFor(() => expect(params().has("task")).toBe(false), SLOW);
    expect(params().get("session")).toBe(session);
  });
});
