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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLIC_REENTRY_SOURCES } from "@flow-state-dev/engine";
import { entriesOf, RETRYABLE_SOURCES, type ThreadEntry } from "../src/adapter";
import { Entry } from "../src/components/Entry";
import { Thread } from "../src/components/Thread";
import { createFakeLab } from "./fake-lab";

afterEach(cleanup);

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

describe("the adapter reads a failed turn", () => {
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

describe("the main thread", () => {
  it("shows a failed turn's line and retries the newest one through the adapter", async () => {
    const fake = createFakeLab({ speed: 0.001 });
    const row = await fake.openSession("session", "project-vendor-notes");
    await act(async () => {
      await fake.send(row.id, "Fix the build");
    });
    act(() => fake.failTurn(row.id, "AI_GATEWAY_API_KEY is not set"));
    render(<Thread adapter={fake} session={row} project={{ id: "project-vendor-notes", name: "vendor-notes" }} tasks={[]} onOpenThread={() => undefined} />);
    expect(screen.getByTestId("request-recovery").textContent).toMatch(/AI_GATEWAY_API_KEY is not set/);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry/ })));
    expect(fake.retries).toEqual([{ sessionId: row.id, requestId: expect.any(String) }]);
    // The turn runs again, so the line keeps its reason but offers no second Retry.
    expect(screen.getByTestId("request-recovery").textContent).toMatch(/AI_GATEWAY_API_KEY is not set/);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("offers Retry on the newest of two failed turns, not the older one", async () => {
    const fake = createFakeLab({ speed: 0.001 });
    const row = await fake.openSession("session", "project-vendor-notes");
    for (const line of ["first", "second"]) {
      await act(async () => {
        await fake.send(row.id, line);
      });
      act(() => fake.failTurn(row.id, `${line} failed`));
    }
    render(<Thread adapter={fake} session={row} project={{ id: "project-vendor-notes", name: "vendor-notes" }} tasks={[]} onOpenThread={() => undefined} />);
    const lines = screen.getAllByTestId("request-recovery");
    expect(lines.map((line) => line.textContent?.includes("Retry"))).toEqual([false, true]);
  });
});
