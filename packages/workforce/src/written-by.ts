/**
 * `writtenBy`: who wrote one entry of a shared resource. A leaf with zod
 * alone, so a browser parsing entries (`parseWorkstreamEntry`) and the shared
 * resource helper (`shared-resource.ts`) share one shape.
 */
import { z } from "zod";

/**
 * Who wrote one entry: the user, and the worker when one wrote it. Each a
 * non-empty string; nothing else is accepted.
 */
export const writtenBySchema = z
  .object({
    /** The user whose session wrote the entry. */
    userId: z.string().min(1),
    /** The worker that wrote it. Absent when a person wrote it through the app. */
    workerId: z.string().min(1).optional()
  })
  .strict();

/** Who wrote one entry of a shared resource. */
export type WrittenBy = z.infer<typeof writtenBySchema>;
