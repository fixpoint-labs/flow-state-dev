/**
 * A hired seat's incarnation: one id per roster-row write that brings a seat
 * into being (a hire, a re-hire), stamped on that roster row, on the inventory
 * row it publishes, and on the seat minted from it.
 *
 * It is what ties a side effect to the seat it belongs to. An address is
 * reused: a seat fired and hired again answers on the same one, and a declared
 * seat can sit at it too. So every side effect on an address lands only when
 * its target still carries the incarnation of the call making it: a seat is
 * unregistered only when the live one was minted from that incarnation, and
 * an inventory row is written or deleted only while it carries it (or, for a
 * write, while the call's own roster row is current).
 *
 * Rows written before incarnations have none (`null`, BP-030). `null` matches
 * only `null`, on the one legacy path that names it: firing a roster row from
 * before incarnations. A minted seat carries its incarnation in a process-local
 * tag rather than in its settings, so no kind's settings schema has to admit
 * it; the tag is set wherever a seat is minted from a row (`checkHiredSeatRow`,
 * which the boot reload and the repair both read through, and the hire blocks).
 */

const incarnations = new WeakMap<object, string | null>();

/** A fresh incarnation id. */
export function newIncarnation(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Record the row a minted seat came from: its incarnation, or `null` for a
 * row from before incarnations. A seat never tagged (a declared one) was
 * minted from no roster row at all.
 */
export function tagIncarnation(seat: object, incarnation: string | null): void {
  incarnations.set(seat, incarnation);
}

/**
 * The incarnation a minted seat came from: a string, `null` when its row had
 * none, `undefined` when it wasn't minted from a roster row.
 */
export function incarnationOf(seat: object): string | null | undefined {
  return incarnations.get(seat);
}

/**
 * Whether `seat` was minted from a roster row carrying `incarnation`. A `null`
 * incarnation matches only a seat minted from a row from before incarnations,
 * never a declared seat.
 */
export function mintedFrom(seat: object, incarnation: string | null): boolean {
  return incarnations.has(seat) && incarnations.get(seat) === incarnation;
}

/** A stored row's incarnation; `null` when it has none, or predates the field (BP-030). */
export function incarnationOfRow(state: Record<string, unknown>): string | null {
  return typeof state.incarnation === "string" ? state.incarnation : null;
}
