/**
 * The task screen's run reads against a real Lab (V1, V3, V5): the run-lab,
 * whose lead files tasks on its own conversation's board for scripted runs
 * that hold until stopped, one of them on a flow no other worker shares.
 *
 * Every expectation is graded against the Lab's own store, read through its
 * routes or its stores, never against a list written here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { connect } from "../src/lib/connection";
import { collectionOfBoard, createLabReader, type BoardRow } from "../src/lib/reads";
import type { OutputItem } from "@flow-state-dev/core/items";
import {
  followRequest,
  interruptRun,
  mergeItems,
  readRunStatus,
  readSessionItems,
  resolveRunFlow,
  RunReadError,
  taskItems,
} from "../src/lib/run";
import { ClientHttpError } from "@flow-state-dev/client";
import { readRecordedWork } from "@flow-state-dev/harness-manager/browser";
import { openRunLab, RUN_LAB_USER_ID } from "./fixtures/run-lab/lab.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

type Opened = Awaited<ReturnType<typeof openRunLab>>;
let lab: Opened;
let served: ServedLab;
let client: Client;

/** The lead's conversation board's rows, as Shift Manager's own board read returns them. */
async function rows(): Promise<BoardRow[]> {
  return createLabReader(client).readBoard(lab.conversation);
}

/** The row for a filed task, once its run has linked itself: held on the shared flow, or on a worker's own. */
async function linked(kind: "held" | "short", workerFlow: "own" | "shared"): Promise<BoardRow> {
  const worker = lab.workers.find((w) => (workerFlow === "own" ? w.id === lab.ownWorker!.id : w.flow === lab.sharedFlow!));
  const filed = lab.filed.find((f) => f.kind === kind && (kind === "short" || f.workerId === worker!.id))!;
  return eventually(async () => (await rows()).find((r) => r.id === filed.taskId && r.run !== null), `${filed.taskId}'s run link`);
}

beforeAll(async () => {
  lab = await openRunLab();
  served = await serveLab(lab.flowState);
  client = connect({ baseUrl: served.baseUrl, userId: RUN_LAB_USER_ID });
}, 60_000);

afterAll(async () => {
  await lab?.stopHeldRuns();
  await served?.handle.close();
});

describe("finding the run (V1, D1)", () => {
  it("reads the link off the row, and the run's flow off its session, for a worker on the shared flow and one on its own", async () => {
    const same = await linked("held", "shared");
    const own = await linked("held", "own");
    const runtime = await lab.flowState.getRuntime();
    for (const row of [same, own]) {
      const stored = (await runtime.stores.session.get(row.run!.sessionId)) as { flowId?: string } | undefined;
      expect(await resolveRunFlow(client, row.run!.sessionId)).toBe(stored?.flowId);
    }
    // The worker on a flow of its own runs on that flow, not the shared one.
    expect(await resolveRunFlow(client, own.run!.sessionId)).toBe(lab.ownWorker!.flow);
    expect(await resolveRunFlow(client, same.run!.sessionId)).toBe(lab.sharedFlow!);
  });

  it("opens the cross-flow run through its session's flow, and fails through the lead's", async () => {
    const own = await linked("held", "own");
    const flowId = await resolveRunFlow(client, own.run!.sessionId);
    expect(await readRunStatus(client, { flowId, requestId: own.run!.requestId })).toBe("in_progress");
    // The negative: the flow of the board the task is on does not own this request.
    await expect(readRunStatus(client, { flowId: lab.leadFlow, requestId: own.run!.requestId })).rejects.toThrow(/404|not found/i);
  });

  it("a task never claimed names no run", async () => {
    const waiting = lab.filed.find((f) => f.kind === "waiting")!;
    const row = (await rows()).find((r) => r.id === waiting.taskId)!;
    expect(row.status).toBe("pending");
    expect(row.run).toBeNull();
  });
});

describe("the Session's items (V1, V2; BR-5, BR-8)", () => {
  it("a running request's items are in the session read while it runs, the stream brings the rest, and both are this task's alone", async () => {
    const row = await linked("held", "shared");
    const collection = collectionOfBoard(row.boardRef);
    // The session read already holds what the running request has finished so far, and only its own.
    const { items: stored } = await readSessionItems(client, row.run!.sessionId);
    const storedShown = taskItems(stored, collection, row.id).items;
    expect(storedShown.length).toBeGreaterThan(0);
    expect(storedShown.every((i) => i.taskId === row.id && i.requestId === row.run!.requestId)).toBe(true);

    const flowId = await resolveRunFlow(client, row.run!.sessionId);
    const streamed: OutputItem[] = [];
    const statuses: string[] = [];
    const stream = followRequest(client, { flowId, requestId: row.run!.requestId }, {
      onItem: (item) => streamed.push(item),
      onStatus: (status) => statuses.push(status),
      onError: () => undefined,
    });
    try {
      // A step arrives live, about a second after the one before.
      const seen = await eventually(async () => {
        const shown = taskItems(mergeItems(stored, streamed), collection, row.id);
        return shown.items.filter((i) => i.type === "message").length >= 3 ? shown : undefined;
      }, "three narrated steps on the stream");
      expect(seen.shared).toBe(false);
      expect(seen.items.every((i) => i.taskId === row.id && i.requestId === row.run!.requestId)).toBe(true);
      // A fresh session read of the still-running request now carries its finished steps too.
      const { items: later } = await readSessionItems(client, row.run!.sessionId);
      const laterShown = taskItems(later, collection, row.id).items;
      expect(laterShown.filter((i) => i.type === "message").length).toBeGreaterThanOrEqual(3);
      expect(laterShown.every((i) => i.requestId === row.run!.requestId)).toBe(true);
    } finally {
      stream.close();
    }
  });

  // Retired under BR-24: a session one worker kept across its tasks has no
  // subject on a conversation's board, which opens one task session per task.
  // What it guarded, a task's view never holding another task's items, is
  // held here: one worker's two tasks ran in two sessions, and each holds
  // only its own task's items and says it is not shared.
  it("one worker's two finished tasks ran in two sessions, each holding only its own task's items", async () => {
    const shorts = lab.filed.filter((f) => f.kind === "short");
    const both = await eventually(async () => {
      const all = await rows();
      const done = shorts.map((f) => all.find((r) => r.id === f.taskId)!);
      return done.every((r) => r.status === "completed" && r.run !== null) ? done : undefined;
    }, "both short rows to finish", 20_000);
    expect(both[0]!.run!.sessionId).not.toBe(both[1]!.run!.sessionId);
    for (const row of both) {
      const { items } = await readSessionItems(client, row.run!.sessionId);
      const mine = taskItems(items, collectionOfBoard(row.boardRef), row.id);
      expect(mine.shared).toBe(false);
      expect(mine.items.length).toBeGreaterThan(0);
      expect(mine.items.every((i) => i.taskId === row.id && i.requestId === row.run!.requestId)).toBe(true);
    }
  });
});

describe("what the run recorded (V5; BR-19, BR-20)", () => {
  it("lists the plan, files and pull requests a recording flow wrote under this request, and says a flow that records none does", async () => {
    const own = await linked("held", "own");
    const recorded = await eventually(async () => {
      const work = await readRecordedWork(client, own.run!);
      return (work.files?.rows.length ?? 0) > 0 ? work : undefined;
    }, "the recorded rows");
    expect(recorded.plan?.rows.map((s) => [s.title, s.status])).toEqual([
      ["Read the task", "completed"],
      ["Write the audit note", "in_progress"],
    ]);
    expect(recorded.files?.rows).toEqual([{ path: "notes/audit.md", kind: "created" }]);
    // Only the pull request this run's request opened: the session's earlier one is narrowed out by requestId.
    expect(recorded.pullRequests?.rows).toEqual([
      { url: "https://github.com/acme/audit/pull/7", repository: "acme/audit", number: 7, title: "Audit note 7", state: "open", source: "tool" },
    ]);

    const same = await linked("held", "shared");
    expect(await readRecordedWork(client, same.run!)).toEqual({ plan: null, files: null, pullRequests: null });
  });
});

describe("Interrupt (V3; BR-11, BR-12, BR-14)", () => {
  it("aborts the linked request through the run's flow, resolves only once the record reads aborted, and writes nothing to the row", async () => {
    const own = await linked("held", "own");
    const flowId = await resolveRunFlow(client, own.run!.sessionId);
    const before = (await rows()).find((r) => r.id === own.id)!;
    const outcome = await interruptRun(client, { flowId, requestId: own.run!.requestId }, { pollMs: 50 });
    // With the time the record says the run stopped, for the activity line.
    expect(outcome).toEqual({ kind: "aborted", endedAtMs: expect.any(Number) });
    expect(await readRunStatus(client, { flowId, requestId: own.run!.requestId })).toBe("aborted");
    // The link still names the run that was stopped; whatever the board did next is the board's.
    const after = (await rows()).find((r) => r.id === own.id)!;
    expect(after.run).toEqual(before.run);

    // Again, on the finished request: already terminal, so it answers what the record says.
    expect(await interruptRun(client, { flowId, requestId: own.run!.requestId })).toEqual({ kind: "aborted", endedAtMs: outcome.kind === "aborted" ? outcome.endedAtMs : -1 });
  });

  it("an abort of a request that had already finished answers with the record's status (BR-12)", async () => {
    const short = lab.filed.find((f) => f.kind === "short")!;
    const row = await eventually(async () => (await rows()).find((r) => r.id === short.taskId && r.status === "completed"), "a finished row", 20_000);
    const flowId = await resolveRunFlow(client, row.run!.sessionId);
    expect(await interruptRun(client, { flowId, requestId: row.run!.requestId })).toEqual({ kind: "finished", status: "completed" });
  });

  /** Clients whose abort is refused with `refusal`, and whose record reads `status`. */
  function refusing(refusal: ClientHttpError, status: string): { client: Client; statusReads: () => number } {
    let reads = 0;
    const request = {
      abort: async () => {
        throw refusal;
      },
      status: async () => {
        reads += 1;
        return { status };
      },
    };
    return { client: { flow: () => ({ request: () => request }) } as unknown as Client, statusReads: () => reads };
  }

  it("tells an already-finished abort from a refusal by the answer's status, not its wording (BR-12, BR-13)", async () => {
    // Worded without "(409)": the status alone says the request was already terminal.
    const finished = refusing(new ClientHttpError("already terminal", { status: 409, body: "" }), "completed");
    expect(await interruptRun(finished.client, { flowId: "f", requestId: "r" })).toEqual({ kind: "finished", status: "completed" });

    // Worded with "(409)" but refused: still a refusal, carrying its status.
    const refused = refusing(new ClientHttpError("not yours (409)", { status: 403, body: "" }), "in_progress");
    const error = await interruptRun(refused.client, { flowId: "f", requestId: "r" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunReadError);
    expect((error as RunReadError).failure.httpStatus).toBe(403);
    expect(refused.statusReads()).toBe(0);
  });

  it("stops waiting on the record once the screen that asked has closed", async () => {
    const running = refusing(new ClientHttpError("already terminal", { status: 409, body: "" }), "in_progress");
    const closed = new AbortController();
    const waiting = interruptRun(running.client, { flowId: "f", requestId: "r" }, { pollMs: 10, timeoutMs: 60_000, signal: closed.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    closed.abort();
    await expect(waiting).rejects.toBeInstanceOf(RunReadError);
    const readsAtClose = running.statusReads();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(running.statusReads()).toBe(readsAtClose);
  });
});
