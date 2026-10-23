/**
 * The question park on a worker's task turn (FIX-1817 S1, S7): the
 * `parkOnQuestion` tool, as one capability a worker turn composes.
 *
 * Orchestration owns the tool and the rule for offering it
 * (`createParkOnQuestion`): a task turn holding a claim, on a row that isn't
 * asked. This module answers the one thing orchestration can't: where the
 * claimed row lives. A task session works only the conversation that filed
 * its task, so the row is read on the conversation ledger at the partition
 * the session was born for, its readonly `filingSessionId`; orchestration
 * finds the row there that this turn's own request holds.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createParkOnQuestion } from "@flow-state-dev/orchestration";
import { boardAboveOf } from "./board-above";
import { conversationLedgerAt, conversationLedgerResources } from "./ledger";

const park = createParkOnQuestion({
  // The board this session's task is on: server-set state (`./board-above`).
  resolve: async (ctx: BlockContext) => {
    const filing = boardAboveOf(ctx);
    return filing !== undefined ? conversationLedgerAt(ctx, filing) : undefined;
  }
});

/**
 * `parkOnQuestion`, on a turn only while it is offered, read before each
 * model call. One instance per turn: compose it once, beside the task tools.
 * `controlTools`, so a worker's `tools:` line doesn't fence it out.
 */
export const questionPark = defineCapability({
  name: "questionPark",
  resources: { ...conversationLedgerResources },
  presets: {
    tools: { controlTools: async (ctx) => ((await park.offered(ctx as never)) ? [park.tool] : []) },
    default: ["tools"]
  }
});
