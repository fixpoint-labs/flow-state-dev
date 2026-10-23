/**
 * This goal's named control, as scratch patches (`goals/lib/module-patch.mts`). Exported so a
 * goal that composes this one (FIX-2087's closure walk) reuses it rather than copying it.
 * FIX-2087's closure imports these `from`/`to` anchors for its `GOAL_CONTROL` legs: renaming one breaks that run too.
 */
import type { ModulePatch } from "../../lib/index.mts";

/** Each named control, by its `GOAL_CONTROL` name. */
export const PATCHES: Record<string, ModulePatch[]> = {
  // Both cascades off: no ending records the debt, so nothing pays one, and a
  // touch doesn't sweep for dependents an ending missed.
  "no-cascade": [
    {
      module: "packages/orchestration/src/tasks/collection/internal.ts",
      from: String.raw`  if \(recording\?\.owesCascade\?\.\(row as Task, ending\) !== true\) return row;`,
      to: "  return row;"
    },
    {
      module: "packages/orchestration/src/tasks/collection/cascade.ts",
      from: String.raw`  await cancelDeadDependents\(writes, now\);`,
      to: ""
    }
  ]
};
