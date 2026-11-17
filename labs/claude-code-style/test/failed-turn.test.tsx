// @vitest-environment happy-dom
/**
 * A turn that fails reads as a failure. The engine writes an `error` item for
 * every failed request; before, the thread never read that type, so a crash
 * looked like a short answer. Now it is one line under the thread with the
 * reason and, on the newest turn only, a Retry that runs the turn again. The
 * engine retries any failed request, so the screen is what keeps Retry off an
 * older line, where it would re-run a turn the person has moved past. It also
 * keeps Retry off a turn the engine refuses to retry (one a task or the flow
 * itself started), where the button could only fail.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLIC_REENTRY_SOURCES } from "@flow-state-dev/engine";
import { entriesOf, RETRYABLE_SOURCES, type ThreadEntry } from "../src/lib/thread-entries";
import { Entry } from "../src/components/Entry";
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

describe("the thread reads a failed turn", () => {
  it("as one failed entry with the engine's reason, and marks the reply it cut off incomplete", () => {
    const entries = entriesOf([
      message("u1", "r1", "user", "Fix the build"),
      message("a1", "r1", "assistant", "Looking at the", "in_progress"),
      errorItem("e1", "r1", "AI_GATEWAY_API_KEY is not set"),
    ], false, new Set(["r1"]));
    expect(entries.map((e) => e.kind)).toEqual(["user", "assistant", "failed"]);
    expect(entries[1]).toMatchObject({ kind: "assistant", incomplete: true });
    expect(entries[2]).toMatchObject({ kind: "failed", reason: "AI_GATEWAY_API_KEY is not set", code: "PROVIDER_ERROR", requestId: "r1", retryable: true });
  });

  it("offers Retry on the newest turn only", () => {
    const entries = entriesOf([
      message("u1", "r1", "user", "first"),
      errorItem("e1", "r1", "first failed"),
      message("u2", "r2", "user", "second"),
      errorItem("e2", "r2", "second failed"),
    ], false, new Set(["r1", "r2"]));
    const failed = entries.filter((e): e is Extract<ThreadEntry, { kind: "failed" }> => e.kind === "failed");
    expect(failed.map((e) => [e.reason, e.retryable])).toEqual([
      ["first failed", false],
      ["second failed", true],
    ]);
  });

  it("keeps Retry on a failed turn a later item that drew nothing came after", () => {
    // An empty assistant message of another turn draws no entry, so it is not the newest turn.
    const entries = entriesOf([message("u1", "r1", "user", "first"), errorItem("e1", "r1", "failed"), message("a2", "r2", "assistant", "")], false, new Set(["r1"]));
    expect(entries.find((e) => e.kind === "failed")).toMatchObject({ retryable: true });
  });

  it("offers no Retry on a newest turn the engine would refuse to retry", () => {
    // r1 is not among the turns the engine retries: a task or the flow itself started it.
    const entries = entriesOf([message("u1", "r1", "user", "first"), errorItem("e1", "r1", "failed")], false, new Set());
    expect(entries.find((e) => e.kind === "failed")).toMatchObject({ retryable: false });
  });

  it("counts a turn retryable from the same sources the engine retries", () => {
    expect([...RETRYABLE_SOURCES].sort()).toEqual([...PUBLIC_REENTRY_SOURCES].sort());
  });

  it("leaves a finished reply of a turn that worked alone", () => {
    const entries = entriesOf([message("u1", "r1", "user", "hi"), message("a1", "r1", "assistant", "Hello.")]);
    expect(entries[1]).not.toHaveProperty("incomplete");
  });
});

describe("the line a failed turn draws", () => {
  const failed = (retryable: boolean): ThreadEntry => ({ kind: "failed", id: "e1", reason: "The model refused the key.", retryable, requestId: "r1" });

  it("names who failed and why, and Retry calls back", async () => {
    let retried = 0;
    render(<Entry entry={failed(true)} onRetry={async () => void (retried += 1)} />);
    const line = screen.getByTestId("request-recovery");
    expect(line.textContent).toMatch(/The main session couldn't finish this turn/);
    expect(line.textContent).toMatch(/The model refused the key\./);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry/ })));
    expect(retried).toBe(1);
  });

  it("draws no Retry without a callback", () => {
    render(<Entry entry={failed(false)} />);
    expect(screen.getByTestId("request-recovery").textContent).toMatch(/The model refused the key\./);
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
