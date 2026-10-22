/**
 * `reportProgress` on a worker's task turn (FIX-2081 D3): the worker's one
 * task tool, as one capability a worker turn composes beside the question park.
 *
 * Orchestration owns the tool and the rule for offering it
 * (`createReportProgress`): a task turn holding a running row. This module
 * answers the one thing orchestration can't: where the held row lives. An
 * inline plan step's row is on the session's plan ledger, at the partition its
 * drain claimed it on; a dispatched task's row is on the conversation ledger
 * at the partition the task session was born for, its readonly
 * `filingSessionId`. Both are read from server-set state, never from input.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createReportProgress } from "@flow-state-dev/orchestration";
import { currentWorkerClaim } from "@flow-state-dev/orchestration/task-board";
import { boardAboveOf } from "./board-above";
import { conversationLedgerAt, conversationLedgerResources } from "./ledger";
import { PLAN_LEDGER_ID, planLedgerAt, planLedgerResources } from "./plan";

const progress = createReportProgress({
  resolve: async (ctx: BlockContext) => {
    // An inline step: the plan drain's claim names its ledger and partition.
    const claim = currentWorkerClaim(ctx);
    if (claim?.collectionId === PLAN_LEDGER_ID && claim.partition !== undefined) {
      return planLedgerAt(ctx, claim.partition);
    }
    // A dispatched task: the board this session's task is on (`./board-above`).
    const filing = boardAboveOf(ctx);
    return filing !== undefined ? conversationLedgerAt(ctx, filing) : undefined;
  }
});

/**
 * `reportProgress`, on a turn only while it is offered, read before each
 * model call. One instance per turn: compose it once, beside the task tools.
 * `controlTools`, so a worker's `tools:` line doesn't fence it out.
 */
export const taskProgress = defineCapability({
  name: "taskProgress",
  resources: { ...conversationLedgerResources, ...planLedgerResources },
  presets: {
    tools: { controlTools: async (ctx) => ((await progress.offered(ctx as never)) ? [progress.tool] : []) },
    default: ["tools"]
  }
});
