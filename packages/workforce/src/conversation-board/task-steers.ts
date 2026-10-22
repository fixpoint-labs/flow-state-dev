/**
 * The worker's steer context (FIX-2086). The row is the conversation ledger
 * at the partition the task session was born for (`filingSessionId`). An
 * inline plan step reads its task's steers; a step takes none of its own.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createSteerContext } from "@flow-state-dev/orchestration";
import { FILING_SESSION_STATE_KEY } from "../workers/keys";
import { conversationLedgerAt, conversationLedgerResources } from "./ledger";

const steerContext = createSteerContext({
  resolve: async (ctx: BlockContext) => {
    const filing = (ctx.session.state as Record<string, unknown> | undefined)?.[FILING_SESSION_STATE_KEY];
    return typeof filing === "string" ? conversationLedgerAt(ctx, filing) : undefined;
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
