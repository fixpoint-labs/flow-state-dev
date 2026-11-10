/**
 * Your marks on threads, in your own user state: the threads you pinned and
 * the failed attempts you dismissed. User state is one record per user, read
 * by every flow that declares it, so the `pins` and `dismissals` flows declare
 * this one schema rather than each its own half.
 */
import { z } from "zod";

/** Your user state as the lab's thread-mark flows read and write it. */
export const userMarksSchema = z.object({
  pinned: z.array(z.string()).default([]),
  dismissed: z.array(z.string()).default([]),
});
