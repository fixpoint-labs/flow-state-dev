/**
 * The fixture app: three kits listed against their `requires` order.
 *
 * `B_FOLDER`, when set, is the app's path for `b`'s folder (read against the
 * working directory); otherwise `b` reads `b/` beside this file. `GOAL_CASE`
 * is read by `kits.mts`, and `unrequired` also lists kit `e`.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { b, c, d, e } from "./kits.mts";

const folder = process.env.B_FOLDER;

export default createFlowState({
  // Never in requires order: that would hide an install in list order.
  kits: [d(), b(folder === undefined ? {} : { directory: folder }), c(), ...(process.env.GOAL_CASE === "unrequired" ? [e()] : [])],
  root: import.meta.url,
  stores: { default: { primary: inMemoryStores() } },
});
