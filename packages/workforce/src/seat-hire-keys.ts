/**
 * The two registry keys the seat-hire capability installs its collections
 * under — the hired roster and the seat inventory.
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

/** Registry key the capability installs the seat inventory under. */
export const SEAT_INVENTORY_RESOURCE = "seatInventory";
