/**
 * The shape of one channel post as a browser sees it: the component name a
 * post's line is emitted under, and the line itself.
 *
 * A leaf module on purpose (BP-019), like `../seat-hire-keys.ts`. A client
 * that shows a channel filters the session's items on
 * {@link CHANNEL_POST_COMPONENT}, and these used to live in `channel-flow.ts`,
 * which imports the channel board and, through the orchestration skills
 * library and the task board, `node:async_hooks`. Nothing here imports
 * anything but `zod`, so `@flow-state-dev/workforce/browser` can re-export it.
 */

import { z } from "zod";

/**
 * The component name every post's line is emitted under. **Pinned**: a client
 * that shows a channel filters the session's items on it, and the docs name it.
 */
export const CHANNEL_POST_COMPONENT = "channel-post";

/** One line of a channel's transcript. Append-only; never rewritten. */
export const channelTranscriptLineSchema = z.object({
  /** Stable per-line id, minted at append. */
  id: z.string(),
  /** Epoch milliseconds at append. */
  at: z.number(),
  /**
   * The server-derived identity the post ran under. Constant for a given
   * channel — see `channel-flow.ts`'s module header. Never caller-supplied.
   */
  principal: z.string(),
  /** The poster's claim about which seat wrote the line. Unverified. */
  author: z.string().optional(),
  /**
   * Always `false` in this floor. Spelled out rather than omitted so a reader
   * of a stored line cannot mistake the `author` field for a proven one.
   */
  authorVerified: z.literal(false),
  body: z.string()
});

export type ChannelTranscriptLine = z.infer<typeof channelTranscriptLineSchema>;
