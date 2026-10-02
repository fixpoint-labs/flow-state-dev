/**
 * Control `static-brief`: the shift summary's asks are written in once and
 * never move.
 *
 * Built into the control page in place of `src/lib/derive.ts`. Everything is
 * the real module but `shiftSummary`, which keeps the first asks it saw: the
 * summary says two things need the person, and lists both, after one has been
 * answered. The goal must fail at "inline".
 */
import { shiftSummary as live, type LoadedSnapshot } from "../../../../labs/shift-manager/src/lib/derive.ts";
export * from "../../../../labs/shift-manager/src/lib/derive.ts";

let written: LoadedSnapshot["asks"] | undefined;

export function shiftSummary(snapshot: LoadedSnapshot): ReturnType<typeof live> {
  const summary = live(snapshot);
  if (written === undefined && summary.asks.ok && summary.asks.value.length > 0) written = summary.asks;
  return { ...summary, asks: written ?? summary.asks };
}
