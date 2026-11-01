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
import type { BoardTask, LabAdapter } from "../src/adapter";
import { PopupView } from "../src/components/Popups";
import { createFixtureLab } from "./fake-lab";

const fast = () => createFixtureLab({ speed: 0.05 });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const workers = () => screen.getByRole("navigation", { name: "Workers" });
const conversation = () => screen.getByRole("main", { name: "Conversation" });
const workerRow = (name: string) => workers().querySelector<HTMLElement>(`[data-worker="${name}"]`)!;
const params = () => new URLSearchParams(window.location.search);
const TASK = "Coding task: Fix the typo in the README's first line";

async function tell(worker: string, text: string) {
  const box = await screen.findByLabelText(`Message ${worker}`);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
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
  it("reopens the teammate that was open, not the first, after a reload", async () => {
    const adapter = fast();
    render(<App adapter={adapter} />);
    await waitFor(() => expect(workerRow("Chief of Staff").getAttribute("aria-current")).toBe("true"));
    fireEvent.click(workerRow("writer"));
    await screen.findByLabelText("Message writer");

    reload(adapter);
    expect(await screen.findByLabelText("Message writer")).toBeTruthy();
    expect(workerRow("writer").getAttribute("aria-current")).toBe("true");
    expect(workerRow("Chief of Staff").getAttribute("aria-current")).not.toBe("true");
  });

  it("reopens the task popup that was open, after a reload", async () => {
    const adapter = fast();
    render(<App adapter={adapter} />);
    await tell("Chief of Staff", "Fix the typo in the README's first line.");
    fireEvent.click(await within(conversation()).findByRole("button", { name: `${TASK}, on Cursor` }));
    await screen.findByRole("dialog", { name: TASK });

    reload(adapter);
    const popup = await screen.findByRole("dialog", { name: TASK });
    expect(await within(popup).findByRole("region", { name: "Result" }, { timeout: 2000 })).toBeTruthy();
  });

  it("goes Back to the teammate that was open before", async () => {
    render(<App adapter={fast()} />);
    await screen.findByLabelText("Message Chief of Staff");
    fireEvent.click(workerRow("writer"));
    await screen.findByLabelText("Message writer");
    fireEvent.click(workerRow("researcher"));
    await screen.findByLabelText("Message researcher");

    // Not the first teammate, which any fallback would land on: the one before.
    await back();
    expect(await screen.findByLabelText("Message writer")).toBeTruthy();
  });

  it("opens the first teammate on a link whose teammate and task are gone, and drops them from the address", async () => {
    window.history.replaceState(null, "", "/?worker=teammates.gone&session=session-gone&task=task-gone");
    render(<App adapter={fast()} />);
    expect(await screen.findByLabelText("Message Chief of Staff")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(params().get("worker")).toBe("teammates.chief-of-staff"));
    expect(params().has("session")).toBe(false);
    expect(params().has("task")).toBe(false);
  });

  it("closes a task popup whose task is gone, and keeps the teammate", async () => {
    const adapter = fast();
    render(<App adapter={adapter} />);
    await screen.findByLabelText("Message Chief of Staff");
    fireEvent.click(workerRow("writer"));
    await screen.findByLabelText("Message writer");
    // Opened once, so the conversation's session is in the address to name.
    const session = await adapter.openConversation("teammates.writer");
    window.history.replaceState(null, "", `/?worker=teammates.writer&session=${session}&task=task-gone`);

    reload(adapter);
    expect(await screen.findByLabelText("Message writer")).toBeTruthy();
    await waitFor(() => expect(params().has("task")).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(params().get("worker")).toBe("teammates.writer");
  });

  it("keeps a task popup open when it moves to a task in another conversation and back", async () => {
    // Each conversation's tasks arrive as soon as they are watched, so only a
    // popup that judges one conversation's task by another's rows drops it.
    const rows: Record<string, BoardTask[]> = {
      "session-a": [{ id: "task-a", to: "teammates.writer", title: "Draft the notes", status: "running" }],
      "session-b": [{ id: "task-b", to: "teammates.researcher", title: "Look it up", status: "running" }],
    };
    const adapter: LabAdapter = { ...fast(), watchTasks: (sessionId, onChange) => (onChange(rows[sessionId] ?? []), () => {}) };
    const missing: string[] = [];
    const draw = (sessionId: string, taskId: string) => (
      <PopupView adapter={adapter} popup={{ kind: "task", sessionId, taskId }} nameOf={(id) => id} lookOf={() => ({}) as never} isCoding={() => false} onClose={() => {}} onMissing={() => missing.push(taskId)} />
    );
    const { rerender } = render(draw("session-a", "task-a"));
    await screen.findByRole("dialog", { name: /draft the notes/i });
    rerender(draw("session-b", "task-b"));
    await screen.findByRole("dialog", { name: /look it up/i });
    rerender(draw("session-a", "task-a"));
    await screen.findByRole("dialog", { name: /draft the notes/i });
    expect(missing).toEqual([]);
  });
});
