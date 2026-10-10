/**
 * A control's scratch patches, applied to source modules as a process loads
 * them, so the control changes the code under test without writing to the
 * checkout.
 *
 * Loaded through `NODE_OPTIONS=--import <this file>` by the process a control
 * starts. It reads `GOAL_MODULE_PATCH`, a JSON `{ patches: [{ file, from, to
 * }], mark }`, and registers the load hook in `module-patch-hooks.mjs`, which
 * rewrites each named module's source and appends the file to `mark` when it
 * does, so the run can show the patch reached the code it served.
 *
 * `module-patch.mts` builds the environment and prints the patch. Two goals
 * keep a one-patch copy of this under their own `controls/`.
 */
import { register } from "node:module";

const spec = process.env.GOAL_MODULE_PATCH;
if (spec !== undefined && spec !== "") {
  register(new URL("./module-patch-hooks.mjs", import.meta.url), { data: JSON.parse(spec) });
}
