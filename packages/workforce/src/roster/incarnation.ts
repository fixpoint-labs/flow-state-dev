/**
 * A hired seat's incarnation: one id per roster-row write that brings a seat
 * into being (a hire, a re-hire), stamped on that roster row, on the inventory
 * row it publishes, and on the seat minted from it.
 *
 * It is what ties a side effect to the seat it belongs to. An address is
 * reused: a seat fired and hired again answers on the same one, and a declared
 * seat can sit at it too. So a step that acts on an address checks the
 * incarnation first — fire deletes an inventory row only if it carries the
 * incarnation fired (or none), and a retry counts a registration as its own
 * only if the live seat carries its incarnation.
 *
 * Rows written before incarnations have none (`null`, BP-030), which matches
 * nothing newer. A minted seat carries its incarnation in a process-local
 * tag rather than in its settings, so no kind's settings schema has to admit
 * it; the tag is set wherever a seat is minted from a row (`checkHiredSeatRow`,
 * which the boot reload and the repair both read through, and the hire blocks).
 */

const incarnations = new WeakMap<object, string>();

/** A fresh incarnation id. */
export function newIncarnation(): string {
  return globalThis.crypto.randomUUID();
}

/** Record the incarnation a minted seat came from. A `null` one records nothing. */
export function tagIncarnation(seat: object, incarnation: string | null): void {
  if (incarnation !== null) incarnations.set(seat, incarnation);
}

/** The incarnation a minted seat came from, or `undefined` when it wasn't minted from a row that had one. */
export function incarnationOf(seat: object): string | undefined {
  return incarnations.get(seat);
}

/** A stored row's incarnation; `null` when it has none, or predates the field (BP-030). */
export function incarnationOfRow(state: Record<string, unknown>): string | null {
  return typeof state.incarnation === "string" ? state.incarnation : null;
}
