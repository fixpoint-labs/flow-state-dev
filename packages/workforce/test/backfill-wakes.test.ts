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
import { RUN_BOARD_ENTRY } from "../src/conversation-board/board-entries";
import { bootBoardHost, type BoardHost } from "./conversation-board-harness";

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
  await host.act("alice", conv, "dispatchTask_tasks", { goal: "done long ago", assignee: "eng.tasker" });
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
  const kept = await wakes.get({ sessionId: conv, entry: RUN_BOARD_ENTRY });
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
    await host.act("alice", conv, "dispatchTask_tasks", { goal: "heard on time", assignee: "eng.tasker" });
    await host.settled();
    const runtime = await host.state.getRuntime();
    expect(await backfillBoardWakes(runtime.stores, { userCell })).toBe(0);
    expect(await backfillBoardWakes({ ...runtime.stores, wakes: undefined } as never, { userCell })).toBe(0);
  }, 20_000);
});
