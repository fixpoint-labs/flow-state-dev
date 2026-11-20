// @vitest-environment happy-dom
/**
 * A turn that fails reads as a failure. The engine writes an `error` item for
 * every failed request; before, the conversation dropped that item, so a crash
 * looked like a short answer. Now it is one line under the worker's name with
 * the reason and, on the newest turn only, a Retry that runs the turn again.
 * The engine retries any failed request, so the screen is what keeps Retry off
 * an older line, where it would re-run a turn the person has moved past. It
 * also keeps Retry off a turn the engine refuses to retry (one a task or the
 * flow itself started), where the button could only fail: the turn's own
 * `retryable`, which the engine sets by its retry route's rule, says which.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import type { ItemLine } from "@flow-state-dev/react";
import { scriptedServer, ScriptedProvider } from "./scripted-server";
import { boardPass, drawLines, failure, linesOf, message } from "./lines";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const LEAD = "teammates.chief-of-staff";
const failedOf = (lines: ItemLine[]) => lines.filter((line): line is Extract<ItemLine, { kind: "failed" }> => line.kind === "failed");

describe("a failed turn's line", () => {
  it("is one failed line with the engine's reason, and marks the reply it cut off incomplete", () => {
    const lines = linesOf(
      [message("u1", "r1", "user", "Draft the launch post"), message("a1", "r1", "assistant", "Here is a first", "in_progress"), failure("e1", "r1", "AI_GATEWAY_API_KEY is not set")],
      [{ id: "r1", status: "failed", retryable: true }],
    );
    expect(lines.map((line) => line.kind)).toEqual(["user", "assistant", "failed"]);
    expect(lines[1]).toMatchObject({ kind: "assistant", incomplete: true });
    expect(lines[2]).toMatchObject({ kind: "failed", requestId: "r1", retryable: true });
  });

  it("offers Retry on the newest turn only, a later board pass that drew nothing aside", () => {
    const lines = linesOf(
      [message("u1", "r1", "user", "first"), failure("e1", "r1", "first failed"), message("u2", "r2", "user", "second"), failure("e2", "r2", "second failed"), boardPass("c1", "dispatch-1")],
      [{ id: "r1", status: "failed", retryable: true }, { id: "r2", status: "failed", retryable: true }],
    );
    expect(failedOf(lines).map((line) => line.retryable)).toEqual([false, true]);
  });

  it("offers no Retry on a newest turn the engine would refuse to retry", () => {
    const lines = linesOf([message("u1", "r1", "user", "first"), failure("e1", "r1", "failed")], [{ id: "r1", status: "failed", retryable: false }]);
    expect(failedOf(lines).map((line) => line.retryable)).toEqual([false]);
  });
});

describe("the line a failed turn draws", () => {
  const failed = (retryable: boolean) => linesOf([failure("e1", "r1", "The model refused the key.")], [{ id: "r1", status: "failed", retryable }])[0]!;
  const draw = (line: ItemLine, retry?: (requestId: string) => Promise<void>) => drawLines([line], { who: "Lead", ...(retry ? { retry } : {}) });

  it("names the worker and the reason, and Retry runs the line's turn again", async () => {
    const retried: string[] = [];
    draw(failed(true), async (requestId) => void retried.push(requestId));
    const line = screen.getByTestId("request-recovery");
    expect(line.textContent).toMatch(/Lead couldn't finish this turn/);
    expect(line.textContent).toMatch(/The model refused the key\./);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry/ })));
    expect(retried).toEqual(["r1"]);
  });

  it("draws no Retry on a line the model offers none on, nor where the screen can't run one", () => {
    draw(failed(false), async () => {});
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    cleanup();
    draw(failed(true));
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});

describe("the conversation", () => {
  it("shows a failed turn's line and retries only the newest through workforce's client", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    const sessionId = lab.conversationOf(LEAD);
    lab.failTurn(sessionId, "first failed");
    lab.failTurn(sessionId, "AI_GATEWAY_API_KEY is not set");
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    await waitFor(() => expect(screen.getAllByTestId("request-recovery")).toHaveLength(2));
    const lines = screen.getAllByTestId("request-recovery");
    expect(lines.map((line) => line.textContent?.includes("Retry"))).toEqual([false, true]);
    expect(lines[1]!.textContent).toMatch(/AI_GATEWAY_API_KEY is not set/);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry/ })));
    expect(lab.retries).toEqual([{ sessionId, requestId: expect.any(String) }]);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull());
  });

  // A host's own source is one the engine retries too: the turn's `retryable` says so, which no browser copy of the source list could.
  it("offers Retry on a turn from a host's own source the engine retries", async () => {
    const lab = scriptedServer({ speed: 0.05, retrySources: ["slack"] });
    const sessionId = lab.conversationOf(LEAD);
    lab.failTurn(sessionId, "The model timed out.", { source: "slack" });
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    await waitFor(() => expect(screen.getByTestId("request-recovery").textContent).toMatch(/The model timed out\./));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: /Retry/ })));
    expect(lab.retries).toEqual([{ sessionId, requestId: expect.any(String) }]);
  });
});
