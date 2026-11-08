// FIX-2403.
/**
 * What the Shift Coordinator's empty conversation offers to start with:
 * lines built from the delegates its coordinator answered for the
 * conversation, by the names the roster gives them. Shift Manager runs any
 * Lab, so no worker is named here; every name comes from what was read.
 */

/** A delegate as the starter lines name it: its worker id and what the user reads it by. */
export type StarterDelegate = { worker: string; name: string };

/** At most this many lines name a delegate, so the list stays a handful. */
const NAMED = 2;

/**
 * The lines an empty conversation offers. A click puts one in the composer;
 * nothing is sent. With no delegates read (no conversation yet, or none
 * listed), the lines name nobody.
 */
export function starterLines(delegates: readonly StarterDelegate[]): string[] {
  if (delegates.length === 0) return ["What can you do for me?", "What needs my attention today?"];
  return [
    "What can the team do for me?",
    ...delegates.slice(0, NAMED).map((delegate) => `Hand ${delegate.name} something to look into`),
  ];
}
