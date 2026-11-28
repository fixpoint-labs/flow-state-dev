/**
 * Control `static-brief`: the shift summary's count of what needs the person
 * is written in once and never moves.
 *
 * Built into the control page in place of `src/lib/tasks.ts`. Everything is
 * the real module but `shiftSummary`, which keeps the first count of what
 * needs the person it saw: the summary says two things need the person after
 * one has been answered. The goal must fail at "inline".
 */
import { shiftSummary as live } from "../../../../packages/shift-manager/src/lib/tasks.ts";
export * from "../../../../packages/shift-manager/src/lib/tasks.ts";

let written: number | undefined;

export function shiftSummary(...args: Parameters<typeof live>): ReturnType<typeof live> {
  const summary = live(...args);
  if (written === undefined && summary.needsYou > 0) written = summary.needsYou;
  return { ...summary, needsYou: written ?? summary.needsYou };
}
