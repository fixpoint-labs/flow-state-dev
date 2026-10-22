/**
 * Steers on a worker's task turn (FIX-2086): a context entry the worker's
 * model re-reads before every model call, so a steer sent while the task runs
 * reaches the request running it before its next call, with no stop and no
 * attempt used.
 *
 * Orchestration owns the entry and the take (`createSteerContext`). This
 * module answers where the task's row lives: on the conversation ledger at
 * the partition the task session was born for, its readonly
 * `filingSessionId`. An inline plan step runs in its task's request, so it
 * reads its task's steers; a step takes none of its own.
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

/**
 * The steers a running task took, in the worker's context, read before each
 * model call. One instance per turn: compose it once, beside the task tools.
 */
export const taskSteers = defineCapability({
  name: "taskSteers",
  resources: { ...conversationLedgerResources },
  presets: {
    steers: { context: (input, ctx) => steerContext(input, ctx as never) },
    default: ["steers"]
  }
});
