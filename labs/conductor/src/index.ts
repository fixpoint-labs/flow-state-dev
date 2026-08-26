// ---------------------------------------------------------------------------
// @flow-state-dev/conductor — lab barrel (LAB-138).
//
// The harness manager: a board row becomes a watched, settled coding run. One
// epic's board, one detached manager, a checkout that belongs to the run, and a
// verdict read before the row is settled.
//
// **Deliberately three exports.** Everything inside this lab imports the
// individual `./src/*` modules directly, so a wide barrel would be surface
// nothing consumes — and `knip.json` treats this file as the public boundary,
// which means anything re-exported here reads as supported. Re-add a specific
// symbol when LAB-139 or a second phase actually reaches for it (tenet 3).
// ---------------------------------------------------------------------------

export {
  conductorFlow,
  CONDUCTOR_FLOW_KIND,
  type ConductorFlowOptions,
} from "./flow";
