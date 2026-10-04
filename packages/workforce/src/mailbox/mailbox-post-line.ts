/**
 * The shape of one mailbox post as a browser sees it: the component name a
 * post's line is emitted under, and the line itself.
 *
 * A leaf module on purpose (BP-019), like `../seat-hire-keys.ts`. A client
 * that shows a mailbox filters the session's items on
 * {@link MAILBOX_POST_COMPONENT}, and these used to live in `mailbox-flow.ts`,
 * which imports the mailbox board and, through the orchestration skills
 * library and the task board, `node:async_hooks`. Nothing here imports
 * anything but `zod`, so `@flow-state-dev/workforce/browser` can re-export it.
 */

import { z } from "zod";

/**
 * The component name every post's line is emitted under. **Pinned**: a client
 * that shows a mailbox filters the session's items on it, and the docs name it.
 */
export const MAILBOX_POST_COMPONENT = "mailbox-post";

/** One line of a mailbox's transcript. Append-only; never rewritten. */
export const mailboxTranscriptLineSchema = z.object({
  /** Stable per-line id, minted at append. */
  id: z.string(),
  /** Epoch milliseconds at append. */
  at: z.number(),
  /**
   * The server-derived identity the post ran under. Constant for a given
   * mailbox — see `mailbox-flow.ts`'s module header. Never caller-supplied.
   */
  principal: z.string(),
  /** The poster's claim about which seat wrote the line. Unverified. */
  author: z.string().optional(),
  /**
   * Always `false` in this floor. Spelled out rather than omitted so a reader
   * of a stored line cannot mistake the `author` field for a proven one.
   */
  authorVerified: z.literal(false),
  /**
   * The line arrived through the mailbox's `seatPost` action or its answer
   * entry: a seat's own dispatch. A `post`, public or dispatched, never sets
   * it, and it is never copied from the caller's input. Absent on those
   * posts, including one that claims an `author`.
   */
  seatAuthored: z.literal(true).optional(),
  body: z.string()
});

export type MailboxTranscriptLine = z.infer<typeof mailboxTranscriptLineSchema>;

/**
 * The lines in order, keeping the first line with each id: the one rule for
 * merging a mailbox's kept transcript with its posted lines. Not re-exported
 * from the package root or the browser entry.
 */
export function withoutRepeats(lines: readonly MailboxTranscriptLine[]): MailboxTranscriptLine[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line.id)) return false;
    seen.add(line.id);
    return true;
  });
}
