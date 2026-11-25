/**
 * Approve every approval a Lab's requests are waiting on, as a user does in
 * Inbox, and wait for each answered request to finish. For tests whose turn
 * makes a write that waits on the user (a hire, a fire) on the way to what
 * they check.
 */
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import type { Lab } from "../../teams/devteam/host.mts";

/** Approve each pending approval in `lab`; how many it approved. */
export async function approvePending(lab: Lab): Promise<number> {
  const runtime = await lab.state.getRuntime();
  const pending = (await runtime.stores.suspensions.list({ status: "pending" })) as SuspensionRecord[];
  for (const asked of pending) {
    const sent = await lab.door("POST", `${asked.flowId ?? asked.flowKind}/requests/${asked.requestId}/resume`, {
      body: { suspensionId: asked.suspensionId, action: "approve" },
    });
    if (sent.status !== 202) throw new Error(`the approval of ${asked.requestId} was refused: ${JSON.stringify(sent.body)}`);
    for (let i = 0; ; i += 1) {
      const status = String((await runtime.stores.request.get(asked.requestId))?.status);
      if (status !== "suspended" && status !== "in_progress") break;
      if (i === 400) throw new Error(`the approved request ${asked.requestId} never finished`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return pending.length;
}
