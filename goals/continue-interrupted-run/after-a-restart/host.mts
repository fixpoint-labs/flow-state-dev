/**
 * The host the `after-a-restart` goal kills and starts again: a durable server
 * on an on-disk SQLite store, over HTTP, with one turn action.
 *
 * `respond` waits until the server stops when `GOAL_HOLD=1`, so a turn is in
 * flight when the goal kills this process. Started again with `GOAL_HOLD`
 * unset, the same turn answers at once, so a Continue can finish it.
 *
 * Env: `GOAL_DB` (SQLite file), `PORT`. The stale threshold is short so a
 * killed turn is swept in seconds rather than a minute.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { z } from "zod";

const hold = process.env.GOAL_HOLD === "1";

const respond = handler({
  name: "respond",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ answer: z.string() }),
  execute: async ({ message }, ctx) => {
    if (hold) {
      await new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("stopped"))));
    }
    return { answer: `answered: ${message}` };
  },
});

const turns = defineFlow({
  kind: "turns",
  request: { heartbeatIntervalMs: 250 },
  actions: { respond: { inputSchema: z.object({ message: z.string() }), block: respond } },
} as never)();

const flowState = createFlowState({
  flows: [turns],
  stores: { default: { primary: sqliteStores({ filename: process.env.GOAL_DB! }) } },
  durable: true,
  staleSweepThresholdMs: 1_500,
  staleSweepIntervalMs: 500,
} as never);

await serve(flowState, { port: Number(process.env.PORT) });
console.log("host: listening");
