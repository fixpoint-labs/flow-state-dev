// FIX-2614, epic FIX-2471 D12.
/**
 * Routines' pinned names: the four verbs, a routine id's two prefixes, and the
 * key a declared routine is stored under. A leaf module with no imports.
 */

/** The verb a screen lists the user's routines through, on the roster flow. */
export const LIST_ROUTINES_ACTION = "listRoutines";

/** The four routine verbs, the same names as roster actions and as a worker's tools. */
export const ROUTINE_VERBS = {
  list: LIST_ROUTINES_ACTION,
  save: "saveRoutine",
  pause: "pauseRoutine",
  delete: "deleteRoutine"
} as const;

/** A clock routine's id: `clock:<key in the schedule collection>`. */
export const CLOCK_ROUTINE_PREFIX = "clock:";

/** An event routine's id: `event:<subscription id>`. */
export const EVENT_ROUTINE_PREFIX = "event:";

/**
 * The key a declared routine is stored under, in either collection:
 * `cfg_<hash of the roster flow kind and the entry id>` (FIX-2536 D3).
 * **Pinned**: persisted. A user's save refuses a key with this prefix.
 */
export const DECLARED_ROUTINE_KEY_PREFIX = "cfg_";

/**
 * The cadences an event routine may poll at, in minutes (FIX-2536 D3). Checked
 * here; the poll that honours them is FIX-2536's.
 */
export const ROUTINE_CADENCES = [5, 10, 15, 20, 30, 60] as const;
