/**
 * A control's scratch patch, applied to one source module as a process loads
 * it, so the control changes the code under test without writing to the
 * checkout.
 *
 * Loaded through `NODE_OPTIONS=--import <this file>` by the process a control
 * starts (the served Lab, or leg e's host). It reads `GOAL_MODULE_PATCH`, a
 * JSON `{ file, from, to, mark }`, and registers the load hook in
 * `module-patch-hooks.mjs`, which rewrites that one module's source and
 * appends the file to `mark` when it does, so the run can show the patch
 * reached the code it served.
 *
 * The same shape as the closure goal's `workforce-privacy/.../controls/`
 * copy, plus the mark.
 */
import { register } from "node:module";

const spec = process.env.GOAL_MODULE_PATCH;
if (spec !== undefined && spec !== "") {
  register(new URL("./module-patch-hooks.mjs", import.meta.url), { data: JSON.parse(spec) });
}
