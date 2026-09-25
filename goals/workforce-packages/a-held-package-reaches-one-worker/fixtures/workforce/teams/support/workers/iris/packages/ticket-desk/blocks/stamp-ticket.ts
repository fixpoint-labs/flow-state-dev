/**
 * The package's one tool: stamps a ticket and hands back a receipt.
 *
 * Each call bumps a process-wide counter the goal's harness reads between
 * turns. That count, not the reply, is the evidence a call happened: a model
 * can write a receipt-shaped string without calling anything.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export default handler({
  name: "stamp-ticket",
  description: "Stamps a support ticket as logged and returns its receipt.",
  inputSchema: z.object({ ticket: z.string() }),
  outputSchema: z.object({ receipt: z.string() }),
  execute: () => {
    const counter = globalThis as { __goalStampCalls?: number };
    counter.__goalStampCalls = (counter.__goalStampCalls ?? 0) + 1;
    return { receipt: "QUILL-7730" };
  },
});
