// @vitest-environment happy-dom
/**
 * What is open survives a reload, a link and Back. A reload here is the app
 * drawn afresh on the same lab with nothing but the page's address: every
 * case asserts on what is drawn, never on the address alone, so an app that
 * writes the address and ignores it on load fails.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import type { Client } from "@flow-state-dev/client";
import { codingTask, stubServer, TestProvider, POPUP_READ } from "./stub-server";
import { PopupView } from "../src/components/Popups";
import { scriptedServer, ScriptedProvider, rosterReadsBy, type ScriptedServer } from "./scripted-server";

const fast = () => scriptedServer({ speed: 0.05 });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const workers = () => screen.getByRole("navigation", { name: "Workers" });
const workerRow = (name: string) => workers().querySelector<HTMLElement>(`[data-worker="${name}"]`)!;
const params = () => new URLSearchParams(window.location.search);
const TASK = "Coding task: Fix the typo in the README's first line";

/** The app drawn afresh on the same lab and server, as a reload draws it: only the address carries over. */
function reload(adapter: ScriptedServer, client?: Client) {
  cleanup();
  render(<TestProvider server={adapter} client={client}><App /></TestProvider>);
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
    render(<ScriptedProvider server={adapter}><App /></ScriptedProvider>);
    await waitFor(() => expect(workerRow("Lead").getAttribute("aria-current")).toBe("true"));
    fireEvent.click(workerRow("writer"));
    await screen.findByLabelText("Message writer");

    reload(adapter);
    expect(await screen.findByLabelText("Message writer")).toBeTruthy();
    expect(workerRow("writer").getAttribute("aria-current")).toBe("true");
    expect(workerRow("Lead").getAttribute("aria-current")).not.toBe("true");
  });

  it("reopens the task popup that was open, after a reload", async () => {
    const adapter = fast();
    const { client } = stubServer({
      board: {
        "conversation:teammates.chief-of-staff": [
          codingTask({ id: "t1", assignee: "teammates.cursor", harness: "cursor", title: "Fix the typo in the README's first line", status: "in_progress", detail: { answer: "Fixed the typo.", answerCut: false } }),
        ],
      },
    });
    render(<TestProvider server={adapter} client={client}><App /></TestProvider>);
    const panel = await screen.findByRole("complementary", { name: "Lead's panel" });
    fireEvent.click(await within(panel).findByRole("button", { name: `${TASK}, on Cursor` }, POPUP_READ));
    await screen.findByRole("dialog", { name: TASK }, POPUP_READ);

    reload(adapter, client);
    const popup = await screen.findByRole("dialog", { name: TASK }, POPUP_READ);
    expect(await within(popup).findByRole("region", { name: "Result" }, { timeout: 2000 })).toBeTruthy();
  });

  it("goes Back to the teammate that was open before", async () => {
    render(<ScriptedProvider server={fast()}><App /></ScriptedProvider>);
    await screen.findByLabelText("Message Lead");
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
    render(<ScriptedProvider server={fast()}><App /></ScriptedProvider>);
    expect(await screen.findByLabelText("Message Lead")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(params().get("worker")).toBe("teammates.chief-of-staff"));
    expect(params().has("session")).toBe(false);
    expect(params().has("task")).toBe(false);
  });

  it("closes a task popup whose task is gone, and keeps the teammate", async () => {
    const adapter = fast();
    render(<ScriptedProvider server={adapter}><App /></ScriptedProvider>);
    await screen.findByLabelText("Message Lead");
    fireEvent.click(workerRow("writer"));
    await screen.findByLabelText("Message writer");
    // Opened once, so the conversation's session is in the address to name.
    const session = adapter.conversationOf("teammates.writer");
    window.history.replaceState(null, "", `/?worker=teammates.writer&session=${session}&task=task-gone`);

    reload(adapter);
    expect(await screen.findByLabelText("Message writer")).toBeTruthy();
    await waitFor(() => expect(params().has("task")).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(params().get("worker")).toBe("teammates.writer");
  });

  it("opens the teammate Back names, when Back comes before the roster is read", async () => {
    const lab = fast();
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    // The roster's first read lands only once the test releases it.
    const client = rosterReadsBy(lab, (_, read) => held.then(read));
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    await act(async () => {
      window.history.pushState(null, "", "/?worker=teammates.writer");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await act(async () => release());
    expect(await screen.findByLabelText("Message writer")).toBeTruthy();
    expect(params().get("worker")).toBe("teammates.writer");
  });

  it("keeps a task popup open when it moves to a task in another conversation and back", async () => {
    // Each conversation's tasks arrive as soon as they are watched, so only a
    // popup that judges one conversation's task by another's rows drops it.
    const { client } = stubServer({
      board: {
        "session-a": [codingTask({ id: "task-a", assignee: "teammates.writer", title: "Draft the notes", status: "in_progress" })],
        "session-b": [codingTask({ id: "task-b", assignee: "teammates.researcher", title: "Look it up", status: "in_progress" })],
      },
    });
    const adapter = fast();
    const missing: string[] = [];
    const draw = (sessionId: string, taskId: string) => (
      <TestProvider server={adapter} client={client}>
        <PopupView popup={{ kind: "task", sessionId, taskId }} nameOf={(id) => id} lookOf={() => ({}) as never} isCoding={() => false} coders={[]} onClose={() => {}} onMissing={() => missing.push(taskId)} />
      </TestProvider>
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
