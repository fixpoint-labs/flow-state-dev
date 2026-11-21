/**
 * A scripted judgment step's prompt, for tests that check what reached it from
 * somewhere other than the user: the Shift Coordinator's `WORKER.md`, or memory.
 */
import type { GeneratorModelCallOptions } from "@flow-state-dev/core/types";

/** A step's prompt as text, without the user's own messages. Throws when no step ran. */
export function promptWithoutUser(options: GeneratorModelCallOptions | undefined): string {
  if (options === undefined) throw new Error("no judgment step ran");
  return JSON.stringify((options.messages as Array<{ role?: string }>).filter((m) => m.role !== "user"));
}
