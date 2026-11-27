// @vitest-environment happy-dom
/**
 * A turn that fails reads as a failure. The engine writes an `error` item for
 * every failed request; before, the thread never read that type, so a crash
 * looked like a short answer. Now it is one line under the thread with the
 * reason and, on the newest turn only, a Retry that runs the turn again. The
 * engine retries any failed request, so the screen is what keeps Retry off an
 * older line, where it would re-run a turn the person has moved past. It also
 * keeps Retry off a turn the engine refuses to retry (one a task or the flow
 * itself started), where the button could only fail: the turn's `retryable`,
 * which the engine sets, says which.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { conversationLines } from "@flow-state-dev/react";
import { LineContext } from "../src/components/flow-state/conversation-lines";
import { claudeCodeRenderers, WorkLines } from "../src/components/lines";
import { Thread } from "../src/components/Thread";
import { closeApps, openTestApp, readUntil, type TestApp } from "./app-host";

afterEach(async () => {
  cleanup();
  await closeApps();
});

/** An `error` item as `runAction.ts` writes one for a failed request. */
const errorItem = (id: string, requestId: string, message: string, code = "PROVIDER_ERROR") => ({ id, type: "error", status: "failed", requestId, message, code });
const message = (id: string, requestId: string, role: string, text: string, status = "completed") => ({
  id,
  type: "message",
  requestId,
  role,
  status,
  content: [{ type: "output_text", text }],
});

describe("the line a failed turn draws", () => {
  const items = [message("u1", "r1", "user", "Fix the build"), message("a1", "r1", "assistant", "Looking at the", "in_progress"), errorItem("e1", "r1", "The model refused the key.")];
  const drawn = (retryable: boolean, retry?: (requestId: string) => Promise<unknown>) => {
    const lines = conversationLines(items as never, [{ id: "r1", status: "failed", retryable }], { renderers: claudeCodeRenderers });
    return render(
      <LineContext.Provider value={{ who: "The main session", ...(retry === undefined ? {} : { retry }) }}>
        <WorkLines lines={lines} />
      </LineContext.Provider>,
    );
  };

  it("names who failed and why, marks the reply it cut off incomplete, and Retry runs that turn", async () => {
    const retried: string[] = [];
    const { container } = drawn(true, async (requestId) => void retried.push(requestId));
    const line = screen.getByTestId("request-recovery");
    expect(line.textContent).toMatch(/The main session couldn't finish this turn/);
    expect(line.textContent).toMatch(/The model refused the key\./);
    expect(container.querySelector('[data-entry="assistant"]')!.getAttribute("data-incomplete")).toBe("true");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry/ })));
    expect(retried).toEqual(["r1"]);
  });

  it("draws no Retry on a turn the engine won't run again, or where the screen can't", () => {
    drawn(false, async () => undefined);
    expect(screen.getByTestId("request-recovery").textContent).toMatch(/The model refused the key\./);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    cleanup();
    drawn(true);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});

/** A host whose main worker fails each line in `failing` once, with `<line> failed`, and answers it on a retry. */
async function failingApp(failing: string[]): Promise<TestApp> {
  const failed = new Set<string>();
  return openTestApp({
    scripts: {
      "agent-answer": ({ said }) => {
        const line = failing.find((text) => said.slice(said.lastIndexOf('"role":"user"')).includes(text));
        if (line !== undefined && !failed.has(line)) {
          failed.add(line);
          throw new Error(`${line} failed`);
        }
        return { text: "Done." };
      },
    },
  });
}

/** Send `line` in session `sessionId` and wait until its turn has ended. */
async function sendAndSettle(lab: TestApp, sessionId: string, line: string) {
  await lab.calls.send(sessionId, line);
  await readUntil(() => lab.client.sessions.requests(sessionId, { limit: 20 }), (requests) => requests.length > 0 && requests.every((r) => r.status !== "in_progress"));
}

describe("the main thread", () => {
  it("shows a failed turn's line with the engine's reason, and Retry runs it again as a new request", async () => {
    const lab = await failingApp(["Fix the build"]);
    const row = await lab.calls.openSession("session", lab.project!.id);
    await sendAndSettle(lab, row.id, "Fix the build");
    render(lab.wrap(<Thread session={row} project={lab.project} tasks={[]} onOpenThread={() => undefined} />));
    await waitFor(() => expect(screen.getByTestId("request-recovery").textContent).toMatch(/Fix the build failed/), { timeout: 10_000 });
    const turns = async () => (await lab.client.sessions.requests(row.id, { limit: 20 })).filter((r) => r.actionName === "respond");
    const [failed] = await turns();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry/ })));
    // The engine runs the turn again as a new request, and it answers.
    const again = await readUntil(turns, (requests) => requests.some((r) => r.id !== failed!.id && r.status === "completed"));
    expect(again).toHaveLength(2);
    await screen.findByText("Done.", undefined, { timeout: 10_000 });
  });

  it("offers Retry on the newest of two failed turns, not the older one", async () => {
    const lab = await failingApp(["first", "second"]);
    const row = await lab.calls.openSession("session", lab.project!.id);
    for (const line of ["first", "second"]) await sendAndSettle(lab, row.id, line);
    render(lab.wrap(<Thread session={row} project={lab.project} tasks={[]} onOpenThread={() => undefined} />));
    await waitFor(() => expect(screen.getAllByTestId("request-recovery")).toHaveLength(2), { timeout: 10_000 });
    const lines = screen.getAllByTestId("request-recovery");
    expect(lines.map((line) => line.textContent?.includes("Retry"))).toEqual([false, true]);
  });
});
