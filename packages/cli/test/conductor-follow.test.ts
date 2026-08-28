import { describe, expect, it } from "vitest";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { createChildFollow } from "../src/conductor/follow";
import { createStreamTranscript } from "../src/conductor/transcript";
import { runningRequestIds, type StatusRow } from "../src/conductor/types";

function statusEvent(requestId: string, sequence: number, message: string): RequestStreamEvent {
  return {
    stream: "request",
    type: "item.added",
    requestId,
    sequence_number: sequence,
    ts: sequence,
    item: {
      id: `s${sequence}`,
      type: "status",
      message,
      transient: true,
    },
  } as RequestStreamEvent;
}

function waitFor(get: () => boolean, ms = 1_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = setInterval(() => {
      if (get()) {
        clearInterval(tick);
        resolve();
        return;
      }
      if (Date.now() - start > ms) {
        clearInterval(tick);
        reject(new Error("timed out"));
      }
    }, 10);
  });
}

describe("runningRequestIds", () => {
  it("returns only in-flight request ids", () => {
    const running: StatusRow = {
      taskId: "LIVE-1--implement",
      issue: "LIVE-1",
      phase: "implement",
      status: "in_progress",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: "LIVE-1--implement",
        workspacePath: null,
        branch: null,
        outcome: "running",
        reason: null,
        sessionId: null,
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: null,
        requestId: "req-live-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const failed = {
      ...running,
      issue: "FAIL-1",
      status: "pending",
      run: { ...running.run!, outcome: "failed" as const, requestId: "req-old" },
    };
    expect(runningRequestIds([running, failed])).toEqual(["req-live-1"]);
  });
});

describe("createChildFollow", () => {
  it("tails persistEvents on a running request id", async () => {
    const stores = createInMemoryStores();
    const lines: string[] = [];
    const transcript = createStreamTranscript();
    const follow = createChildFollow({
      stores,
      onEvent: (event) => {
        const patch = transcript.apply(event);
        lines.push(...patch.lines);
        if (patch.live !== null) lines.push(patch.live);
      },
    });
    follow.sync(["req-live-1"]);
    stores.request.persistEvents("req-live-1", [
      statusEvent("req-live-1", 1, "coding the checkout"),
    ]);
    await waitFor(() => lines.some((line) => line.includes("coding the checkout")));
    follow.stop();
    expect(lines.join("\n")).toContain("coding the checkout");
  });

  it("does not replay a request it already finished", async () => {
    const stores = createInMemoryStores();
    let hits = 0;
    const follow = createChildFollow({
      stores,
      onEvent: () => {
        hits += 1;
      },
    });
    follow.sync(["req-live-1"]);
    stores.request.persistEvents("req-live-1", [statusEvent("req-live-1", 1, "one")]);
    await waitFor(() => hits > 0);
    follow.sync([]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = hits;
    follow.sync(["req-live-1"]);
    stores.request.persistEvents("req-live-1", [statusEvent("req-live-1", 2, "two")]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hits).toBe(before);
    follow.stop();
  });
});
