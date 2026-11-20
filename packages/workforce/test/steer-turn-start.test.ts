/**
 * Whether the turn a steer is owed was started, as its sender is told.
 *
 * Why it matters: a board that hears "started" tells the sender the task is
 * under way. A dispatch the runtime refused started nothing, and with no wake
 * owed nothing will, so the answer must be no, as a dispatch that threw is.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { DISPATCH_SEAM, type DispatchOutcome } from "@flow-state-dev/core/internal";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { startOwedSteerTurn } from "../src/conversation-board/steer-turn-start";

const task = { id: "task_1", run: { sessionId: "s_worker" } } as unknown as Task;

/** A context whose dispatch seam answers `outcome`, with no wake backend. */
const ctxAnswering = (outcome: DispatchOutcome) => ({ [DISPATCH_SEAM]: async () => outcome }) as unknown as BlockContext;

describe("startOwedSteerTurn", () => {
  it("answers started when the dispatch starts the turn", async () => {
    expect(await startOwedSteerTurn(ctxAnswering({ ok: true, sessionId: "s_worker", requestId: "r_1", adopted: false }), task)).toBe(true);
  });

  it("answers not started when the runtime refuses the dispatch and no wake is owed", async () => {
    expect(await startOwedSteerTurn(ctxAnswering({ ok: false, refused: "no-entry", detail: "no steer-turn entry" }), task)).toBe(false);
  });
});
