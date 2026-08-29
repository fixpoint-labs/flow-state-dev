import { describe, expect, it } from "vitest";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { createChildFollow } from "../src/conductor/follow";
import { createStreamTranscript } from "../src/conductor/transcript";
import {
  emptyView,
  idsToFollow,
  runningRequestIds,
  settledRequestIds,
  type StatusRow,
} from "../src/conductor/types";

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

  it("does not treat a parked question as in-flight when the run record still says running", () => {
    const parked: StatusRow = {
      taskId: "ASK-1--implement",
      issue: "ASK-1",
      phase: "implement",
      status: "awaiting_review",
      attempts: 2,
      feedback: null,
      run: {
        attempt: 2,
        taskId: "ASK-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/ASK-1--implement",
        outcome: "running",
        reason: "asked",
        sessionId: "sess",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: null,
        requestId: "req-ask-1",
        updatedAt: 1,
      },
      questions: [
        {
          question: "ASK-1/implement/2/q",
          text: "Cannot create a pull request",
          attempt: 2,
          askedAt: 1,
        },
      ],
    };
    expect(runningRequestIds([parked])).toEqual([]);
    expect(settledRequestIds([parked])).toEqual(["req-ask-1"]);
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

  it("keeps the tail after the row leaves the running set", async () => {
    const stores = createInMemoryStores();
    const seen: number[] = [];
    const follow = createChildFollow({
      stores,
      onEvent: (event) => {
        seen.push(event.sequence_number);
      },
    });
    follow.sync(["req-live-1"]);
    stores.request.persistEvents("req-live-1", [statusEvent("req-live-1", 1, "one")]);
    await waitFor(() => seen.includes(1));
    follow.sync([]);
    stores.request.persistEvents("req-live-1", [statusEvent("req-live-1", 2, "two")]);
    await waitFor(() => seen.includes(2));
    follow.stop();
    expect(seen).toEqual([1, 2]);
  });

  it("calls onEnd once the journal closes", async () => {
    const stores = createInMemoryStores();
    const ended: string[] = [];
    const follow = createChildFollow({
      stores,
      onEvent: () => {},
      onEnd: (requestId) => {
        ended.push(requestId);
      },
    });
    follow.sync(["req-live-1"]);
    stores.request.persistEvents("req-live-1", [
      statusEvent("req-live-1", 1, "one"),
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-live-1",
        sequence_number: 2,
        ts: 2,
      } as RequestStreamEvent,
    ]);
    await waitFor(() => ended.includes("req-live-1"));
    follow.stop();
    expect(ended).toEqual(["req-live-1"]);
  });

  it("does not start a second tail after the journal ends", async () => {
    const stores = createInMemoryStores();
    let hits = 0;
    const follow = createChildFollow({
      stores,
      onEvent: () => {
        hits += 1;
      },
    });
    follow.sync(["req-live-1"]);
    stores.request.persistEvents("req-live-1", [
      statusEvent("req-live-1", 1, "one"),
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-live-1",
        sequence_number: 2,
        ts: 2,
      } as RequestStreamEvent,
    ]);
    await waitFor(() => hits >= 2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = hits;
    follow.sync(["req-live-1"]);
    stores.request.persistEvents("req-live-1", [statusEvent("req-live-1", 3, "three")]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hits).toBe(before);
    follow.stop();
  });

  it("catch-up a journal that already ended", async () => {
    const stores = createInMemoryStores();
    const seen: number[] = [];
    const follow = createChildFollow({
      stores,
      onEvent: (event) => {
        seen.push(event.sequence_number);
      },
    });
    stores.request.persistEvents("req-done-1", [
      statusEvent("req-done-1", 1, "one"),
      statusEvent("req-done-1", 2, "two"),
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-done-1",
        sequence_number: 3,
        ts: 3,
      } as RequestStreamEvent,
    ]);
    follow.sync(["req-done-1"]);
    await waitFor(() => seen.includes(1) && seen.includes(2));
    follow.stop();
    expect(seen).toEqual(expect.arrayContaining([1, 2]));
  });

  it("drain catch-up a journal that already ended", async () => {
    const stores = createInMemoryStores();
    const seen: number[] = [];
    const follow = createChildFollow({
      stores,
      onEvent: (event) => {
        seen.push(event.sequence_number);
      },
    });
    stores.request.persistEvents("req-done-1", [
      statusEvent("req-done-1", 1, "one"),
      statusEvent("req-done-1", 2, "two"),
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-done-1",
        sequence_number: 3,
        ts: 3,
      } as RequestStreamEvent,
    ]);
    await follow.drain(["req-done-1"]);
    follow.stop();
    expect(seen).toEqual(expect.arrayContaining([1, 2]));
  });

  it("reload returns a finished journal again without going through onEvent", async () => {
    const stores = createInMemoryStores();
    let hits = 0;
    const follow = createChildFollow({
      stores,
      onEvent: () => {
        hits += 1;
      },
    });
    stores.request.persistEvents("req-done-1", [
      statusEvent("req-done-1", 1, "one"),
      statusEvent("req-done-1", 2, "two"),
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-done-1",
        sequence_number: 3,
        ts: 3,
      } as RequestStreamEvent,
    ]);
    await follow.drain(["req-done-1"]);
    const before = hits;
    const again = await follow.reload("req-done-1");
    follow.stop();
    expect(hits).toBe(before);
    expect(again.map((event) => event.sequence_number)).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("reload of an active tail is empty", async () => {
    const stores = createInMemoryStores();
    const follow = createChildFollow({
      stores,
      onEvent: () => {},
    });
    follow.sync(["req-live-1"]);
    const again = await follow.reload("req-live-1");
    follow.stop();
    expect(again).toEqual([]);
  });

  it("drain of an already-finished id is immediate and does not reprint", async () => {
    const stores = createInMemoryStores();
    let hits = 0;
    const follow = createChildFollow({
      stores,
      onEvent: () => {
        hits += 1;
      },
    });
    stores.request.persistEvents("req-done-1", [
      statusEvent("req-done-1", 1, "one"),
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-done-1",
        sequence_number: 2,
        ts: 2,
      } as RequestStreamEvent,
    ]);
    await follow.drain(["req-done-1"]);
    const before = hits;
    await follow.drain(["req-done-1"]);
    follow.stop();
    expect(hits).toBe(before);
  });

  it("drain of a missing journal does not hang", async () => {
    const stores = createInMemoryStores();
    const follow = createChildFollow({
      stores,
      onEvent: () => {},
    });
    await Promise.race([
      follow.drain(["req-missing"]),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("drain hung on a missing journal")), 200);
      }),
    ]);
    follow.stop();
  });

  it("drain waits for an active tail to end", async () => {
    const stores = createInMemoryStores();
    const ended: string[] = [];
    const follow = createChildFollow({
      stores,
      onEvent: () => {},
      onEnd: (requestId) => {
        ended.push(requestId);
      },
    });
    follow.sync(["req-live-1"]);
    stores.request.persistEvents("req-live-1", [statusEvent("req-live-1", 1, "one")]);
    let done = false;
    const draining = follow.drain(["req-live-1"]).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(done).toBe(false);
    stores.request.persistEvents("req-live-1", [
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-live-1",
        sequence_number: 2,
        ts: 2,
      } as RequestStreamEvent,
    ]);
    await draining;
    follow.stop();
    expect(done).toBe(true);
    expect(ended).toEqual(["req-live-1"]);
  });

  it("followed is true only after this process started a tail", async () => {
    const stores = createInMemoryStores();
    const follow = createChildFollow({
      stores,
      onEvent: () => {},
    });
    expect(follow.followed("req-done-1")).toBe(false);
    stores.request.persistEvents("req-done-1", [
      statusEvent("req-done-1", 1, "one"),
      {
        stream: "request",
        type: "request.completed",
        status: "completed",
        requestId: "req-done-1",
        sequence_number: 2,
        ts: 2,
      } as RequestStreamEvent,
    ]);
    await follow.drain(["req-done-1"]);
    expect(follow.followed("req-done-1")).toBe(true);
    follow.stop();
  });
});

describe("idsToFollow", () => {
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
  const failed: StatusRow = {
    ...running,
    taskId: "FAIL-1--implement",
    issue: "FAIL-1",
    status: "pending",
    run: { ...running.run!, outcome: "failed", requestId: "req-old", reason: "Not logged in" },
  };

  it("includes the selected row's last request after it settled", () => {
    const state = { ...emptyView("epic"), rows: [failed, running], selected: 0 };
    expect(idsToFollow(state)).toEqual(["req-live-1", "req-old"]);
  });

  it("does not duplicate the selected running id", () => {
    const state = { ...emptyView("epic"), rows: [failed, running], selected: 1 };
    expect(idsToFollow(state)).toEqual(["req-live-1"]);
  });
});

describe("settledRequestIds", () => {
  it("returns last-attempt ids on rows that are no longer running", () => {
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
    const failed: StatusRow = {
      ...running,
      taskId: "FAIL-1--implement",
      issue: "FAIL-1",
      status: "pending",
      run: { ...running.run!, outcome: "failed", requestId: "req-fail-1" },
    };
    expect(settledRequestIds([running, failed])).toEqual(["req-fail-1"]);
  });
});
