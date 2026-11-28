/**
 * Control `unanswerable-asks`: Shift Manager marks every ask unanswerable.
 *
 * Built into the control page in place of `src/lib/inbox.ts`. Everything is
 * the real module except `useInbox`, whose answer marks each hold as one
 * Shift Manager can't answer, so no card offers Approve. The goal must fail
 * at "an answer lands in the store" on a Lab holding an ask.
 */
import { useMemo } from "react";
import { useInbox as asWritten } from "../../../../packages/shift-manager/src/lib/inbox.ts";

export * from "../../../../packages/shift-manager/src/lib/inbox.ts";

/** What each card says under the control. */
const UNANSWERABLE = "Marked unanswerable by the control.";

/** The real inbox view, with every hold marked unanswerable. */
export function useInbox(...args: Parameters<typeof asWritten>): ReturnType<typeof asWritten> {
  const read = asWritten(...args);
  const section = useMemo(() => {
    if (read.section === undefined || !read.section.ok) return read.section;
    const items = read.section.value.items.map((item) => ({
      ...item,
      answerable: false,
      unanswerable: UNANSWERABLE,
      holds: item.holds.map((hold) => ({ ...hold, answerable: false, unanswerable: UNANSWERABLE })),
    }));
    return { ok: true as const, value: { ...read.section.value, items } };
  }, [read.section]);
  return { ...read, section };
}
