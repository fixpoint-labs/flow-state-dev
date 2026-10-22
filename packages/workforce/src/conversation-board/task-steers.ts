/**
 * The worker's steer context (FIX-2086). The row is the conversation ledger
 * at the partition of the board above the session (`./board-above`): the one
 * it was born for, or the routing conversation in a workstream's session. An
 * inline plan step reads its task's steers; a step takes none of its own.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createSteerContext } from "@flow-state-dev/orchestration";
import { boardAboveOf } from "./board-above";
import { conversationLedgerAt, conversationLedgerResources } from "./ledger";

const steerContext = createSteerContext({
  resolve: async (ctx: BlockContext) => {
    const partition = boardAboveOf(ctx);
    return partition === undefined ? undefined : conversationLedgerAt(ctx, partition);
  }
});

/** One instance per turn: compose it once, beside the task tools. */
export const taskSteers = defineCapability({
  name: "taskSteers",
  resources: { ...conversationLedgerResources },
  presets: {
    steers: { context: (input, ctx) => steerContext(input, ctx as never) },
    default: ["steers"]
  }
});
