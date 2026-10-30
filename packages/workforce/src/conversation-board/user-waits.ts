/**
 * The two ways a worker's model waits on the user (FIX-2131): `holdTaskForUser`,
 * which holds its task on a question, and `suspendForUser`, which stops the turn
 * for the user's approval, review or (on a turn with no task row) input, as
 * one capability a worker turn composes.
 *
 * Orchestration owns the tools and the rules for offering them
 * (`createHoldTaskForUser`, `createSuspendForUserTool`): `holdTaskForUser` on a task turn
 * holding a running row, `suspendForUser` on a host that can stop a request for
 * the user. This module answers the one thing orchestration can't: where the
 * held row lives. A task session works only the conversation that filed its
 * task, so the row is read on the conversation ledger at the partition the
 * session was born for, its readonly `filingSessionId`; orchestration finds the
 * row there that this turn's own request holds.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createHoldTaskForUser, createSuspendForUserTool } from "@flow-state-dev/orchestration";
import { boardAboveOf } from "./board-above";
import { conversationLedgerAt, conversationLedgerResources } from "./ledger";

// The board this session's task is on: server-set state (`./board-above`).
const resolve = async (ctx: BlockContext) => {
  const filing = boardAboveOf(ctx);
  return filing !== undefined ? conversationLedgerAt(ctx, filing) : undefined;
};

const ask = createHoldTaskForUser({ resolve });
const wait = createSuspendForUserTool({ resolve });

/**
 * `holdTaskForUser` and `suspendForUser`, each on a turn only while it is offered,
 * read before each model call. One instance per turn: compose it once, beside
 * the task tools. `controlTools`, so a worker's `tools:` line doesn't fence
 * them out.
 */
export const userWaits = defineCapability({
  name: "userWaits",
  resources: { ...conversationLedgerResources },
  presets: {
    tools: {
      controlTools: async (ctx) => {
        const [asks, waits] = await Promise.all([ask.offered(ctx as never), wait.offered(ctx as never)]);
        return [...(asks ? [ask.tool] : []), ...(waits ? [wait.tool] : [])];
      }
    },
    default: ["tools"]
  }
});
