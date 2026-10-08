/**
 * A scratch patch applied to one source module as the served process loads
 * it, so a control changes the commit without writing to the checkout.
 *
 * Loaded through `NODE_OPTIONS=--import <this file>` by the Shift Manager
 * process a control boots (`patches.mts` → `modulePatchEnv`). It reads
 * `GOAL_MODULE_PATCH`, a JSON `{ file, from, to }`, and registers the load
 * hook in `module-patch-hooks.mjs`, which rewrites that one module's source.
 */
import { register } from "node:module";

const spec = process.env.GOAL_MODULE_PATCH;
if (spec !== undefined && spec !== "") {
  register(new URL("./module-patch-hooks.mjs", import.meta.url), { data: JSON.parse(spec) });
}
