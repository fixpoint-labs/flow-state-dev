// FIX-2624.
/**
 * Your marks on threads: the threads you pinned and the failed attempts you
 * dismissed. Each is a user resource the screen reads by scope and key with no
 * session, and writes through the default write flow (`runBy: "default"`), so
 * a pin is one line in the adapter and no flow of the lab's.
 *
 * A leaf module: the screen imports these definitions to read and
 * write them, the host declares them on a flow it serves.
 *
 * They used to live in your user state, written by the lab's `pins` and
 * `dismissals` flows; the host copies those old lists across once
 * ({@link LEGACY_MARK_FIELDS}).
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

// BP-030; FIX-2628 removes this with the copy.
/**
 * The user-state fields the old `pins` and `dismissals` flows kept these in,
 * and the resource each moves to, kept so old records still read.
 */
export const LEGACY_MARK_FIELDS = [
  { field: "pinned", resource: labPins.ref },
  { field: "dismissed", resource: labDismissals.ref },
] as const;
