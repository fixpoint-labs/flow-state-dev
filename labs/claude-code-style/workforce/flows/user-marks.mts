// FIX-2624.
/**
 * Your marks on threads: the threads you pinned and the failed attempts you
 * dismissed. Each is a user resource the screen reads by scope and key with no
 * session, and writes through the default write flow (`runBy: "default"`), so
 * a pin is one line in the adapter and no flow of the lab's.
 *
 * A leaf module: the screen imports these definitions to read and
 * write them, the host declares them on a flow it serves.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

/** The threads you pinned, by task id: each once. */
export const labPins = defineResource({
  ref: "lab-pins",
  scope: "user",
  stateSchema: z.object({ pinned: z.array(z.string()).default([]) }),
  client: {},
  runBy: "default",
  canWrite: ({ next }) => new Set(next.pinned).size === next.pinned.length,
});

/**
 * The failed attempts you dismissed, as `dismissalKey`s (`<task id>#<attempt>`):
 * one per task, so a retry that fails again waits on you again.
 */
export const labDismissals = defineResource({
  ref: "lab-dismissals",
  scope: "user",
  stateSchema: z.object({ dismissed: z.array(z.string()).default([]) }),
  client: {},
  runBy: "default",
});
