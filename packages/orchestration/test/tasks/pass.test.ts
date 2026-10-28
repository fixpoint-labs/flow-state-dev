/**
 * The board's pass (FIX-2078): how it resends a past-due notice, and what it
 * leaves owed for the next one. A notice whose entry keeps failing is resent
 * with a growing gap, never on every pass; and a pass that started with no
 * wake still records when its next debt falls due.
 */
import { describe, expect, it } from "vitest";
import { DISPATCH_SEAM } from "@flow-state-dev/core/types";
import { payBoardDebts, settlePassWake } from "../../src/tasks/notice/pass";
import { NOTICE_DUE_MS } from "../../src/tasks/notice/task-notice";
import type { Task } from "../../src/tasks/schema/task";

function board(rows: Task[], clock: { t: number }) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    collectionId: "plans",
    now: () => clock.t,
    list: () => [...byId.values()],
    get: (id: string) => byId.get(id),
    async patchMetadata(id: string, patch: Record<string, unknown>) {
      const row = byId.get(id)!;
      byId.set(id, { ...row, metadata: { ...(row.metadata ?? {}), ...patch } });
      return { outcome: "recorded" };
    }
  };
}

function session(sent: unknown[], owed: Array<{ entry: string; dueAt: number }> = []) {
  return {
    session: { identity: { id: "filer" } },
    requestHost: {
      wakes: {
        maxDebtAgeMs: 86_400_000,
        owe: async (spec: { entry: string; dueAt: number }) => {
          owed.push(spec);
          return true;
        },
        read: async () => undefined,
        settle: async () => "cleared"
      }
    },
    [DISPATCH_SEAM]: async (spec: { payload: unknown }) => {
      sent.push(spec.payload);
      // The entry is busy: the notice stays owed.
      return { ok: false, refused: "busy", detail: "busy" };
    }
  };
}

const ended = (at: number): Task =>
  ({
    id: "t1",
    goal: "g",
    status: "completed",
    attempts: 1,
    createdAt: 0,
    updatedAt: at,
    metadata: { "noticeOwed:1:completed": { attempt: 1, ending: "completed", due: at + NOTICE_DUE_MS } }
  }) as unknown as Task;

describe("a board's pass", () => {
  it("resends a notice its entry keeps refusing with a growing gap, not on every pass", async () => {
    const clock = { t: 10_000 };
    const ref = board([ended(0)], clock);
    const sent: unknown[] = [];
    const ctx = session(sent);
    const sendsAt: number[] = [];
    // A pass every 2 s for a minute.
    for (; clock.t < 70_000; clock.t += 2_000) {
      const before = sent.length;
      await payBoardDebts(ctx as never, ref as never);
      if (sent.length > before) sendsAt.push(clock.t);
    }
    // Every 2 s would be 30 sends; backing off doubles the gap each time.
    expect(sendsAt.length).toBeLessThanOrEqual(5);
    expect(sendsAt[0]).toBe(10_000);
    const gaps = sendsAt.slice(1).map((at, i) => at - sendsAt[i]!);
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
  });

  it("doesn't end a notice a busy session turned away lately, however old its due time (FIX-2113)", async () => {
    // Due a day and a minute ago, past the 24 h maximum debt age; turned away a minute ago.
    const day = 86_400_000;
    const clock = { t: day + 120_000 };
    const turnedAway = ended(0);
    const marker = (turnedAway.metadata as Record<string, Record<string, unknown>>)["noticeOwed:1:completed"]!;
    const ref = board(
      [{ ...turnedAway, metadata: { "noticeOwed:1:completed": marker, "noticeDeferred:1:completed": { at: clock.t - 60_000 } } } as Task],
      clock
    );
    const sent: unknown[] = [];
    await payBoardDebts(session(sent) as never, ref as never);
    // Still owed and sent again, never settled undeliverable.
    const metadata = ref.get("t1")!.metadata as Record<string, unknown>;
    expect(metadata["noticeUndeliverable:1:completed"]).toBeUndefined();
    expect(metadata["noticeOwed:1:completed"]).toMatchObject({ attempt: 1, ending: "completed" });
    expect(sent).toHaveLength(1);
    // The same notice never turned away is past the age, and ends.
    const old = board([ended(0)], clock);
    await payBoardDebts(session([]) as never, old as never);
    expect((old.get("t1")!.metadata as Record<string, unknown>)["noticeUndeliverable:1:completed"]).toBeDefined();
  });

  it("says when its next resend falls due, so the wake waits for it", async () => {
    const clock = { t: 10_000 };
    const ref = board([ended(0)], clock);
    const ctx = session([]);
    await payBoardDebts(ctx as never, ref as never);
    const { nextDue } = await payBoardDebts(ctx as never, ref as never);
    expect(nextDue).toBeGreaterThan(clock.t + NOTICE_DUE_MS);
  });

  it("owes the next debt's due time when it started with no wake to move", async () => {
    const owed: Array<{ entry: string; dueAt: number }> = [];
    const ctx = session([], owed);
    await settlePassWake(ctx as never, "runTaskBoard", undefined, 42_000);
    expect(owed).toEqual([{ entry: "runTaskBoard", dueAt: 42_000 }]);
    await settlePassWake(ctx as never, "runTaskBoard", undefined, undefined);
    expect(owed).toHaveLength(1);
  });
});
