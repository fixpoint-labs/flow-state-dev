/**
 * The hired roster: the durable half of a seat hired while the app runs.
 *
 * `collections.ts` owns what is stored and why the write verb matters.
 * `rows.ts` owns what a row means and what a hired seat is called.
 * `reload.ts` owns reading the whole thing back at boot, and which failures
 * stop that boot. This file only re-exports.
 */

export {
  HIRED_ROSTER_PREFIX,
  defineHiredRosterCollection,
  defineHiredRosterPrivateCollection,
  hiredSeatRowSchema,
  type HiredSeatRow,
} from "./collections";

export {
  hiredRosterStorageKey,
  hiredSeatManifest,
  hiredSeatOwnerPin,
  hiredSeatRowFromManifest,
  parseHiredSeatRow,
  seatAddress,
  splitSeatAddress,
  toHiredSeatRow,
  type RowProblem,
} from "./rows";

export {
  hiredSeatOwnerPinFromRosterOwner,
  registerHiredSeat,
} from "./register-hired-seat";

export {
  DEFAULT_MAX_RELOAD_ORGS,
  DEFAULT_ROSTER_READ_TIMEOUT_MS,
  reloadHiredSeats,
  type HiredRosterReload,
  type HiredRosterStores,
  type ReloadHiredSeatsOptions,
} from "./reload";
