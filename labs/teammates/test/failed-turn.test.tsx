// @vitest-environment happy-dom
/**
 * A turn that fails reads as a failure. The engine writes an `error` item for
 * every failed request; before, the conversation dropped that item, so a crash
 * looked like a short answer. Now it is one line under the worker's name with
 * the reason and, on the newest turn only, a Retry that runs the turn again.
 * The engine retries any failed request, so the screen is what keeps Retry off
 * an older line, where it would re-run a turn the person has moved past. It
 * also keeps Retry off a turn the engine refuses to retry (one a task or the
 * flow itself started), where the button could only fail.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PUBLIC_REENTRY_SOURCES } from "@flow-state-dev/engine";
import { RETRYABLE_SOURCES, toEntries, type ConversationEntry } from "../src/adapter";
import { Entry } from "../src/components/Entry";
import { lookOf } from "../src/lib/looks";
import { createFixtureLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const LEAD = "teammates.chief-of-staff";
/** An `error` item as `runAction.ts` writes one for a failed request. */
const errorItem = (id: string, requestId: string, message: string, code = "PROVIDER_ERROR") => ({ id, type: "error", status: "failed", requestId, message, code });
const message = (id: string, requestId: string, role: string, text: string, status = "completed") => ({
  id,
  type: "message",
  requestId,
  role,
  agentName: role === "assistant" ? LEAD : undefined,
  status,
  content: [{ type: "output_text", text }],
});
/** A board pass's row change: an item that draws no entry. */
const boardPass = (id: string, requestId: string) => ({ id, type: "component", component: "task-change", status: "completed", requestId, data: { task: { id: "t1", status: "pending", assignee: LEAD, title: "t1" } } });
const failedOf = (entries: ConversationEntry[]) => entries.filter((e): e is Extract<ConversationEntry, { kind: "failed" }> => e.kind === "failed");

describe("the adapter reads a failed turn", () => {
  it("as one failed entry with the engine's reason, and marks the reply it cut off incomplete", () => {
    const entries = toEntries(
      [message("u1", "r1", "user", "Draft the launch post"), message("a1", "r1", "assistant", "Here is a first", "in_progress"), errorItem("e1", "r1", "AI_GATEWAY_API_KEY is not set")],
      new Set(),
      [],
      new Set(["r1"]),
    );
    expect(entries.map((e) => e.kind)).toEqual(["user", "assistant", "failed"]);
    expect(entries[1]).toEqual({ kind: "assistant", id: "a1", text: "Here is a first", incomplete: true });
    expect(entries[2]).toMatchObject({ kind: "failed", reason: "AI_GATEWAY_API_KEY is not set", code: "PROVIDER_ERROR", requestId: "r1", retryable: true });
  });

  it("offers Retry on the newest turn only", () => {
    const entries = toEntries(
      [message("u1", "r1", "user", "first"), errorItem("e1", "r1", "first failed"), message("u2", "r2", "user", "second"), errorItem("e2", "r2", "second failed")],
      new Set(),
      [],
      new Set(["r1", "r2"]),
    );
    expect(failedOf(entries).map((e) => [e.reason, e.retryable])).toEqual([
      ["first failed", false],
      ["second failed", true],
    ]);
  });

  it("keeps Retry on a failed turn a later board pass wrote no entry for", () => {
    const entries = toEntries([message("u1", "r1", "user", "first"), errorItem("e1", "r1", "failed"), boardPass("c1", "dispatch-1")], new Set(), [], new Set(["r1"]));
    expect(failedOf(entries).map((e) => e.retryable)).toEqual([true]);
  });

  it("offers no Retry on a newest turn the engine would refuse to retry", () => {
    // r1 is not among the turns the engine retries: a task or the flow itself started it.
    const entries = toEntries([message("u1", "r1", "user", "first"), errorItem("e1", "r1", "failed")], new Set(), [], new Set());
    expect(failedOf(entries).map((e) => e.retryable)).toEqual([false]);
  });

  it("counts a turn retryable from the same sources the engine retries", () => {
    expect([...RETRYABLE_SOURCES].sort()).toEqual([...PUBLIC_REENTRY_SOURCES].sort());
  });
});

describe("the line a failed turn draws", () => {
  const failed = (retryable: boolean): ConversationEntry => ({ kind: "failed", id: "e1", requestId: "r1", reason: "The model refused the key.", retryable });
  const draw = (entry: ConversationEntry, onRetry?: () => Promise<void>) =>
    render(<Entry entry={entry} workerName="Lead" nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} {...(onRetry ? { onRetry } : {})} />);

  it("names the worker and the reason, and Retry calls back", async () => {
    let retried = 0;
    draw(failed(true), async () => void (retried += 1));
    const line = screen.getByTestId("request-recovery");
    expect(line.textContent).toMatch(/Lead couldn't finish this turn/);
    expect(line.textContent).toMatch(/The model refused the key\./);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry/ })));
    expect(retried).toBe(1);
  });

  it("draws no Retry without a callback", () => {
    draw(failed(false));
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});

describe("the conversation", () => {
  it("shows a failed turn's line and retries only the newest through the adapter", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    const sessionId = await lab.openConversation(LEAD);
    lab.failTurn(sessionId, "first failed");
    lab.failTurn(sessionId, "AI_GATEWAY_API_KEY is not set");
    render(<App adapter={lab} />);
    await waitFor(() => expect(screen.getAllByTestId("request-recovery")).toHaveLength(2));
    const lines = screen.getAllByTestId("request-recovery");
    expect(lines.map((line) => line.textContent?.includes("Retry"))).toEqual([false, true]);
    expect(lines[1]!.textContent).toMatch(/AI_GATEWAY_API_KEY is not set/);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry/ })));
    expect(lab.retries).toEqual([{ sessionId, requestId: expect.any(String) }]);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull());
  });
});
