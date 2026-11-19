/**
 * A reply debt owed by the request a session refuses for good (FIX-2849).
 *
 * Why it matters: on a crash-recovery replay the refused request is back
 * `in_progress`, so its own debts read as running. Left so, the refused turn
 * would report a debt still owed, fail as a failure that may pass, and be
 * re-driven and refused forever. Named as ended there, its debt is paid.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { WORKER_REPLIES_OWED_STATE } from "../src/messages/keys";
import { WORKER_MESSAGES_RESOURCE } from "../src/messages/log-row";
import { payReplyDebts } from "../src/messages/owed-replies";
import type { WorkerInstallation } from "../src/workers/installation";

/** A session owing a reply to an undelivered message, landed by `by`, which reads as still running. */
function owingContext(by: string) {
  let state: Record<string, unknown> = { [WORKER_REPLIES_OWED_STATE]: [{ id: "msg_1", by }] };
  const ctx = {
    session: {
      identity: { id: "s1" },
      get state() {
        return state;
      },
      atomicState: async (mutate: (current: Record<string, unknown>) => Record<string, unknown>) => {
        state = { ...state, ...mutate(state) };
        return state;
      }
    },
    resources: { [WORKER_MESSAGES_RESOURCE]: { getOptional: async () => ({ state: { status: "unconfirmed" } }) } },
    requestHost: { waits: { running: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, true])) } }
  } as unknown as BlockContext;
  return { ctx, owed: () => state[WORKER_REPLIES_OWED_STATE] as unknown[] };
}

describe("a reply debt owed by the request a session refuses for good", () => {
  it("is paid when that request is named as ended, though its record reads running", async () => {
    const { ctx, owed } = owingContext("req_refused");
    expect(await payReplyDebts(ctx, {} as WorkerInstallation, "agent", "req_refused")).toBeUndefined();
    expect(owed()).toEqual([]);
  });

  it("stays owed for a request that is still running and not the refused one", async () => {
    const { ctx, owed } = owingContext("req_elsewhere");
    expect(await payReplyDebts(ctx, {} as WorkerInstallation, "agent", "req_refused")).toBeGreaterThan(Date.now());
    expect(owed()).toHaveLength(1);
  });
});
