/**
 * The `onTaskSettled` entry a test flow declares when it holds a board that
 * hands rows out (FIX-2078: `defineFlow` refuses one without it), for a test
 * that grades something else. It hears each ending and does nothing with it.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { taskSettledEntry } from "../../src";

/** Spread into a test flow's `internal.actions`. */
export const heard = {
  onTaskSettled: taskSettledEntry({
    block: handler({ name: "test-heard", inputSchema: z.unknown(), outputSchema: z.unknown(), execute: () => ({}) })
  })
};
