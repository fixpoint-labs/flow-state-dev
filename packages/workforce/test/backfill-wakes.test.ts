/**
 * The upgrade's backfill of wakes (FIX-2078, BP-030): a notice owed on a row
 * stored before wakes existed has no due time the engine keeps, so a quiet
 * conversation would never hear it. The backfill owes the wake; the board's
 * pass then sends the notice, with nothing touching the board.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { backfillBoardWakes } from "../src/conversation-board/backfill-wakes";
import { CHECK_TASK_ENTRY, DISPATCH_ENTRY, SPLIT_MARKER } from "../src/conversation-board/board-entries";
import { bootBoardHost, type BoardHost } from "./conversation-board-harness";
import { bootSplitHost } from "./split-harness";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let open: BoardHost | undefined;
afterEach(async () => {
  await open?.dispose();
  open = undefined;
});

const userCell = (userId: string, orgId: string) => resolveUserStorageKey(userId, orgId, { id: "", isolateUserState: false });

/** The notices the conversation's `onTaskSettled` was sent about `taskId`. */
const noticesAbout = async (host: BoardHost, conv: string, taskId: string) =>
  (await host.requestsOf(conv)).filter(
    (r) => r.actionName === "onTaskSettled" && (r.input as { taskId?: string } | undefined)?.taskId === taskId
  );

/** A row as a host before FIX-2078 stored it: its notice owed, with no due time and no wake. */
async function storeLegacyOwed(host: BoardHost, conv: string): Promise<Task> {
  await host.act("alice", conv, "createTask_tasks", { goal: "done long ago", assignee: "eng.tasker" });
  await host.settled();
  const filing = await host.filingOf("alice", conv);
  const [done] = (await host.rows("alice")).filter((r) => r.status === "completed");
  const { partition: _partition, filer: _filer, ...stored } = done!;
  await host.writeRow("alice", filing, {
    ...(stored as Task),
    metadata: { ...(stored.metadata ?? {}), [`noticeOwed:${done!.attempts}:completed`]: { attempt: done!.attempts, ending: "completed" } }
  });
  // The task's own wake, still fenced on its writer's lease, isn't one an old host kept.
  const wakes = (await host.state.getRuntime()).stores.wakes!;
  const kept = await wakes.get({ sessionId: conv, entry: DISPATCH_ENTRY });
  if (kept !== null) expect(await wakes.clear(kept, kept.version)).toBe(true);
  return done!;
}

describe("the upgrade's backfill of wakes", () => {
  it("owes a wake for a session holding a notice stored before wakes, and the conversation hears it with no touch", async () => {
    const host = bootBoardHost({ durable: true });
    open = host;
    await host.state.getRouter();
    const conv = await host.conversation("alice");
    const done = await storeLegacyOwed(host, conv);
    const before = (await noticesAbout(host, conv, done.id)).length;

    const runtime = await host.state.getRuntime();
    expect(await backfillBoardWakes(runtime.stores, { userCell })).toBe(1);

    let heard = before;
    for (let i = 0; i < 100 && heard === before; i += 1) {
      await sleep(50);
      heard = (await noticesAbout(host, conv, done.id)).length;
    }
    expect(heard).toBe(before + 1);
    await host.settled();
    const after = (await host.rows("alice")).find((r) => r.id === done.id)!;
    // Paid: its marker is cleared to `null`.
    expect(Object.entries(after.metadata ?? {}).filter(([key, value]) => key.startsWith("noticeOwed:") && value != null)).toEqual([]);
  }, 20_000);

  it("leaves such a notice unheard without it: nothing else pays a debt with no wake", async () => {
    const host = bootBoardHost({ durable: true });
    open = host;
    await host.state.getRouter();
    const conv = await host.conversation("alice");
    const done = await storeLegacyOwed(host, conv);
    const before = (await noticesAbout(host, conv, done.id)).length;
    await sleep(2_500);
    expect((await noticesAbout(host, conv, done.id)).length).toBe(before);
  }, 20_000);

  it("owes nothing when no row holds an old debt, and nothing on a store without wakes", async () => {
    const host = bootBoardHost({ durable: true });
    open = host;
    const conv = await host.conversation("alice");
    await host.act("alice", conv, "createTask_tasks", { goal: "heard on time", assignee: "eng.tasker" });
    await host.settled();
    const runtime = await host.state.getRuntime();
    expect(await backfillBoardWakes(runtime.stores, { userCell })).toBe(0);
    expect(await backfillBoardWakes({ ...runtime.stores, wakes: undefined } as never, { userCell })).toBe(0);
  }, 20_000);
});

describe("a task stored while a queued message held it open", () => {
  // Its work had answered, and it waited only for a message to run. No
  // message holds a task now, so nothing would check it: it would sit, or
  // its lease would lapse and the work it already answered would run again.
  it("settles once with the answer it kept, after the backfill, and its work never runs again", async () => {
    const h = bootSplitHost({ durable: true });
    open = h;
    await h.state.getRouter();
    h.controls.plans.planner = [{ goal: "Write the memo", assignee: "s1" }];
    const planner = await h.open("alice", "planner");
    await h.turn("alice", planner);
    expect(await h.until(async () => (await h.rowsNamed("alice", "Write the memo"))[0]?.status === "completed", 10_000)).toBe(true);
    await h.settled();

    // Store it as an old host left it mid-hold: running on attempt 1, its
    // answer kept, waiting on the queued message, a lease that has lapsed.
    const [done] = await h.rowsNamed("alice", "Write the memo");
    const { partition: _p, filer: _f, completedAt: _c, ...rest } = done as Task & { partition?: string; filer?: unknown };
    await h.writeRow("alice", decodeURIComponent(done!.partition!), {
      ...rest,
      status: "in_progress",
      keptOpenBy: "queued",
      leaseUntil: Date.now() - 1_000,
      output: "the kept answer"
    } as unknown as Task);
    const runtime = await h.state.getRuntime();
    for (const session of [planner, done!.run!.sessionId]) {
      for (const entry of [DISPATCH_ENTRY, CHECK_TASK_ENTRY]) {
        const kept = await runtime.stores.wakes!.get({ sessionId: session, entry });
        if (kept !== null) await runtime.stores.wakes!.clear(kept, kept.version);
      }
    }
    /** The turns of s1's own work (not a notice's). */
    const workTurns = () => h.controls.turns.filter((turn) => turn.worker === "s1" && !turn.message.startsWith("Task ")).length;
    const worked = workTurns();

    expect(await backfillBoardWakes(runtime.stores, { userCell })).toBeGreaterThanOrEqual(1);
    // A pass of the board that filed it, as a reclaim would take a lapsed lease.
    h.controls.plans.planner = [];
    await h.turn("alice", planner);

    expect(await h.until(async () => (await h.rowsNamed("alice", "Write the memo"))[0]?.status === "completed", 5_000)).toBe(true);
    await h.settled();
    const [after] = await h.rowsNamed("alice", "Write the memo");
    expect(after).toMatchObject({ status: "completed", attempts: done!.attempts, output: "the kept answer" });
    expect(after!.keptOpenBy ?? undefined).toBeUndefined();
    // Its work, which had answered, never ran again.
    expect(workTurns()).toBe(worked);
  }, 30_000);
});

describe("the backfill's other old debt", () => {
  /** Stores holding one conversation row, and the sessions it names. */
  function stores(row: Record<string, unknown>) {
    const owed: Array<{ sessionId: string; entry: string }> = [];
    const session = (id: string) => ({ id, flowKind: "desk", flowId: "desk", userId: "alice", orgId: "org" });
    return {
      owed,
      registry: {
        session: { list: async () => [session("conv"), session("task-session")] },
        resourceState: {
          getByPrefix: async (_scope: "user", cell: string, prefix: string) =>
            cell === userCell("alice", "org") && prefix === "tasks/" ? { "tasks/conv~l1/t1": { state: row } } : {}
        },
        wakes: {
          owe: async (input: { sessionId: string; entry: string }) => {
            owed.push({ sessionId: input.sessionId, entry: input.entry });
            return input;
          }
        }
      }
    };
  }

  it("owes the filing conversation's pass for a report marker stored before wakes", async () => {
    const { owed, registry } = stores({ id: "t1", goal: "g", status: "errored", metadata: { "reportOwed:1": { attempt: 1, error: "x" } } });
    expect(await backfillBoardWakes(registry, { userCell, now: 5 })).toBe(1);
    expect(owed).toEqual([{ sessionId: "conv", entry: DISPATCH_ENTRY }]);
  });

});
