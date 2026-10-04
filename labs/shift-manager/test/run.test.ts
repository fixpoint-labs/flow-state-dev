/**
 * The task screen's run reads against a real Lab (V1, V3, V5): the run-lab,
 * whose board hands rows to scripted runs that hold until stopped, one of them
 * on a flow other than the board drainer's.
 *
 * Every expectation is graded against the Lab's own store, read through its
 * routes or its stores, never against a list written here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLabClients, type LabClients } from "../src/lib/connection";
import { createLabReader, type BoardRow } from "../src/lib/reads";
import type { OutputItem } from "@flow-state-dev/core/items";
import {
  followRequest,
  interruptRun,
  mergeItems,
  readRecordedWork,
  readRunStatus,
  readSessionItems,
  resolveRunFlow,
  RunReadError,
  taskItems,
} from "../src/lib/run";
import { ClientHttpError } from "@flow-state-dev/client";
import { openRunLab, RUN_LAB_USER_ID } from "../../../goals/shift-manager/it-shows-and-stops-a-task-run/lab/lab.mts";
import { eventually, serveLab, type ServedLab } from "./helpers/serve-lab";

type Opened = Awaited<ReturnType<typeof openRunLab>>;
let lab: Opened;
let served: ServedLab;
let clients: LabClients;

/** The board's rows, as Shift Manager's own board read returns them. */
async function rows(): Promise<BoardRow[]> {
  return createLabReader(clients).readBoard(lab.mailbox.id, lab.ledger.id);
}

/** The row for a filed task, once its run has linked itself. */
async function linked(kind: "held" | "short", seatFlow: "own" | "drainer"): Promise<BoardRow> {
  const seat = lab.seats.find((s) => (seatFlow === "own" ? s.flow !== undefined : s.flow === undefined && s.policy === "per-task"));
  const filed = lab.filed.find((f) => f.kind === kind && (kind === "short" || f.seatId === seat!.id))!;
  return eventually(async () => (await rows()).find((r) => r.id === filed.taskId && r.run !== null), `${filed.taskId}'s run link`);
}

beforeAll(async () => {
  lab = await openRunLab();
  served = await serveLab(lab.flowState);
  clients = createLabClients({ baseUrl: served.baseUrl, userId: RUN_LAB_USER_ID });
}, 60_000);

afterAll(async () => {
  await lab?.stopHeldRuns();
  await served?.handle.close();
});

describe("finding the run (V1, D1)", () => {
  it("reads the link off the row, and the run's flow off its session, for a seat on the drainer's flow and one on its own", async () => {
    const same = await linked("held", "drainer");
    const own = await linked("held", "own");
    const runtime = await lab.flowState.getRuntime();
    for (const row of [same, own]) {
      const stored = (await runtime.stores.session.get(row.run!.sessionId)) as { flowId?: string } | undefined;
      expect(await resolveRunFlow(clients, row.run!.sessionId)).toBe(stored?.flowId);
    }
    // The seat on a flow of its own runs on that flow, not the drainer's.
    expect(await resolveRunFlow(clients, own.run!.sessionId)).not.toBe(lab.drainerId);
    expect(await resolveRunFlow(clients, same.run!.sessionId)).toBe(lab.drainerId);
  });

  it("opens the cross-flow run through its session's flow, and fails through the board drainer's", async () => {
    const own = await linked("held", "own");
    const flowId = await resolveRunFlow(clients, own.run!.sessionId);
    expect(await readRunStatus(clients, { flowId, requestId: own.run!.requestId })).toBe("in_progress");
    // The negative: the drainer's flow does not own this request.
    await expect(readRunStatus(clients, { flowId: lab.drainerId, requestId: own.run!.requestId })).rejects.toThrow(/404|not found/i);
  });

  it("a row never claimed names no run", async () => {
    const waiting = lab.filed.find((f) => f.kind === "waiting")!;
    const row = (await rows()).find((r) => r.id === waiting.taskId)!;
    expect(row.status).toBe("pending");
    expect(row.run).toBeNull();
  });
});

describe("the Session's items (V1, V2; BR-5, BR-8)", () => {
  it("a running request's items are in the session read while it runs, the stream brings the rest, and both are this task's alone", async () => {
    const row = await linked("held", "drainer");
    // The session read already holds what the running request has finished so far, and only its own.
    const { items: stored } = await readSessionItems(clients, row.run!.sessionId);
    const storedShown = taskItems(stored, row.boardRef, row.id).items;
    expect(storedShown.every((i) => i.taskId === row.id && i.requestId === row.run!.requestId)).toBe(true);

    const flowId = await resolveRunFlow(clients, row.run!.sessionId);
    const streamed: OutputItem[] = [];
    const statuses: string[] = [];
    const stream = followRequest(clients, { flowId, requestId: row.run!.requestId }, {
      onItem: (item) => streamed.push(item),
      onStatus: (status) => statuses.push(status),
      onError: () => undefined,
    });
    try {
      // A step arrives live, about a second after the one before.
      const seen = await eventually(async () => {
        const shown = taskItems(mergeItems(stored, streamed), row.boardRef, row.id);
        return shown.items.filter((i) => i.type === "message").length >= 3 ? shown : undefined;
      }, "three narrated steps on the stream");
      expect(seen.shared).toBe(false);
      expect(seen.items.every((i) => i.taskId === row.id && i.requestId === row.run!.requestId)).toBe(true);
      // A fresh session read of the still-running request now carries its finished steps too.
      const { items: later } = await readSessionItems(clients, row.run!.sessionId);
      const laterShown = taskItems(later, row.boardRef, row.id).items;
      expect(laterShown.filter((i) => i.type === "message").length).toBeGreaterThanOrEqual(3);
      expect(laterShown.every((i) => i.requestId === row.run!.requestId)).toBe(true);
    } finally {
      stream.close();
    }
  });

  it("the per-worker seat's shared session shows only the stamped items of the task opened, and says it is shared", async () => {
    const shorts = lab.filed.filter((f) => f.kind === "short");
    const both = await eventually(async () => {
      const all = await rows();
      const done = shorts.map((f) => all.find((r) => r.id === f.taskId)!);
      return done.every((r) => r.status === "completed" && r.run !== null) ? done : undefined;
    }, "both short rows to finish", 20_000);
    expect(both[0]!.run!.sessionId).toBe(both[1]!.run!.sessionId);
    const { items } = await readSessionItems(clients, both[0]!.run!.sessionId);
    const first = taskItems(items, both[0]!.boardRef, both[0]!.id);
    const second = taskItems(items, both[1]!.boardRef, both[1]!.id);
    expect(first.shared && second.shared).toBe(true);
    expect(first.items.every((i) => i.taskId === both[0]!.id)).toBe(true);
    expect(second.items.every((i) => i.taskId === both[1]!.id)).toBe(true);
    // Negative: the whole session is more than either task's share of it.
    expect(first.items.length).toBeLessThan(items.length);
  });
});

describe("what the run recorded (V5; BR-19, BR-20)", () => {
  it("lists the plan and files a recording flow wrote under this request, and says a flow that records none does", async () => {
    const own = await linked("held", "own");
    const recorded = await eventually(async () => {
      const work = await readRecordedWork(clients, own.run!);
      return (work.files?.rows.length ?? 0) > 0 ? work : undefined;
    }, "the recorded rows");
    expect(recorded.plan?.rows.map((s) => [s.title, s.status])).toEqual([
      ["Read the task", "completed"],
      ["Write the audit note", "in_progress"],
    ]);
    expect(recorded.files?.rows).toEqual([{ path: "notes/audit.md", kind: "created" }]);

    const same = await linked("held", "drainer");
    expect(await readRecordedWork(clients, same.run!)).toEqual({ plan: null, files: null });
  });
});

describe("Interrupt (V3; BR-11, BR-12, BR-14)", () => {
  it("aborts the linked request through the run's flow, resolves only once the record reads aborted, and writes nothing to the row", async () => {
    const own = await linked("held", "own");
    const flowId = await resolveRunFlow(clients, own.run!.sessionId);
    const before = (await rows()).find((r) => r.id === own.id)!;
    const outcome = await interruptRun(clients, { flowId, requestId: own.run!.requestId }, { pollMs: 50 });
    expect(outcome).toEqual({ kind: "aborted" });
    expect(await readRunStatus(clients, { flowId, requestId: own.run!.requestId })).toBe("aborted");
    // The link still names the run that was stopped; whatever the board did next is the board's.
    const after = (await rows()).find((r) => r.id === own.id)!;
    expect(after.run).toEqual(before.run);

    // Again, on the finished request: already terminal, so it answers what the record says.
    expect(await interruptRun(clients, { flowId, requestId: own.run!.requestId })).toEqual({ kind: "aborted" });
  });

  it("an abort of a request that had already finished answers with the record's status (BR-12)", async () => {
    const short = lab.filed.find((f) => f.kind === "short")!;
    const row = await eventually(async () => (await rows()).find((r) => r.id === short.taskId && r.status === "completed"), "a finished row", 20_000);
    const flowId = await resolveRunFlow(clients, row.run!.sessionId);
    expect(await interruptRun(clients, { flowId, requestId: row.run!.requestId })).toEqual({ kind: "finished", status: "completed" });
  });

  /** Clients whose abort is refused with `refusal`, and whose record reads `status`. */
  function refusing(refusal: ClientHttpError, status: string): { clients: LabClients; statusReads: () => number } {
    let reads = 0;
    const actions = {
      abortRequest: async () => {
        throw refusal;
      },
      getRequestStatus: async () => {
        reads += 1;
        return { status };
      },
    };
    return { clients: { actions: () => actions } as unknown as LabClients, statusReads: () => reads };
  }

  it("tells an already-finished abort from a refusal by the answer's status, not its wording (BR-12, BR-13)", async () => {
    // Worded without "(409)": the status alone says the request was already terminal.
    const finished = refusing(new ClientHttpError("already terminal", { status: 409, body: "" }), "completed");
    expect(await interruptRun(finished.clients, { flowId: "f", requestId: "r" })).toEqual({ kind: "finished", status: "completed" });

    // Worded with "(409)" but refused: still a refusal, carrying its status.
    const refused = refusing(new ClientHttpError("not yours (409)", { status: 403, body: "" }), "in_progress");
    const error = await interruptRun(refused.clients, { flowId: "f", requestId: "r" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunReadError);
    expect((error as RunReadError).failure.httpStatus).toBe(403);
    expect(refused.statusReads()).toBe(0);
  });

  it("stops waiting on the record once the screen that asked has closed", async () => {
    const running = refusing(new ClientHttpError("already terminal", { status: 409, body: "" }), "in_progress");
    const closed = new AbortController();
    const waiting = interruptRun(running.clients, { flowId: "f", requestId: "r" }, { pollMs: 10, timeoutMs: 60_000, signal: closed.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    closed.abort();
    await expect(waiting).rejects.toBeInstanceOf(RunReadError);
    const readsAtClose = running.statusReads();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(running.statusReads()).toBe(readsAtClose);
  });
});
