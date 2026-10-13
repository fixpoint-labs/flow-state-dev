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
import { FILING_SESSION_STATE_KEY } from "../workers/keys";
import { conversationLedgerAt, conversationLedgerResources } from "./ledger";

const park = createParkOnQuestion({
  // The conversation this task session was born for: a readonly birth field.
  resolve: async (ctx: BlockContext) => {
    const filing = (ctx.session.state as Record<string, unknown> | undefined)?.[FILING_SESSION_STATE_KEY];
    return typeof filing === "string" ? conversationLedgerAt(ctx, filing) : undefined;
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
