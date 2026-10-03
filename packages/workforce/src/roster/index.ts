/**
 * The hired roster: the durable half of a seat hired while the app runs.
 *
 * `collections.ts` owns what is stored and why the write verb matters.
 * `rows.ts` owns what a row means and what a hired seat is called.
 * `reload.ts` owns reading the whole thing back at boot, and which failures
 * stop that boot. `check.ts` owns the per-row answer the reload and
 * `brokenSeats` share. `remove.ts` owns the one removal of a hired seat, and `locate.ts`
 * which roster row a seat id names for the caller.
 * This file only re-exports.
 */

export {
  HIRED_ROSTER_BROWSER_PATTERN,
  HIRED_ROSTER_PREFIX,
  HIRED_ROSTER_PRIVATE_PATTERN,
  defineHiredRosterCollection,
  defineHiredRosterPrivateCollection,
  hiredSeatRowSchema,
  type HiredSeatRow,
} from "./collections";

export {
  encodeUserSegment,
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

export { newIncarnation, tagIncarnation } from "./incarnation";

export {
  resolveHiredSeatLocation,
  type HiredSeatLocation,
  type HiredSeatOwner,
  type ResolveHiredSeatLocationOptions,
} from "./locate";

export {
  removeHiredSeat,
  type HiredSeatRelease,
  type RemoveHiredSeatOptions,
  type RemovedHiredSeat,
} from "./remove";

export {
  DEFAULT_MAX_RELOAD_ORGS,
  DEFAULT_ROSTER_READ_TIMEOUT_MS,
  reloadHiredSeats,
  type HiredRosterOrgReload,
  type HiredRosterReload,
  type HiredRosterStores,
  type ReloadHiredSeatsOptions,
} from "./reload";
