/**
 * The two registry keys the seat-hire capability installs its collections
 * under — the hired roster and the seat inventory — the key a flow mounts the
 * user-owned roster under, and the org roster's collection pattern, which a
 * panel finds the roster by.
 *
 * A leaf module on purpose (BP-019). The keys are what a browser panel needs
 * to read a collection through the client, and they used to live in
 * `seat-hire-blocks.ts` next to the handlers that use them. That module
 * imports `hireWorkforce`, so a client component asking for one string pulled
 * the whole hire runtime — and, through the skills library and the task board,
 * `node:async_hooks` — into the browser bundle. Nothing here imports anything,
 * so a panel gets the names and no runtime.
 */

/** Registry key the capability installs the durable roster under. */
export const HIRED_ROSTER_RESOURCE = "hiredRoster";

/**
 * Registry key a flow mounts the user-owned roster
 * (`defineHiredRosterPrivateCollection()`) under, for `fire`, `brokenSeats`
 * and `rehire` to reach the caller's own user-owned seats. The capability does
 * not install it; a flow that has none reaches org-visible seats only.
 */
export const HIRED_ROSTER_PRIVATE_RESOURCE = "hiredRosterPrivate";

/** Registry key the capability installs the seat inventory under. */
export const SEAT_INVENTORY_RESOURCE = "seatInventory";

/**
 * The pattern of the org roster, the collection a browser may read. One
 * segment, so a nested `workforce/roster/~user/seat` key never matches it.
 * Pinned; see `roster/collections.ts`'s header.
 */
export const HIRED_ROSTER_BROWSER_PATTERN = "workforce/roster/*";
