/**
 * This goal's named control and its kill point, as scratch patches (`goals/lib/module-patch.mts`).
 * Exported so a goal that composes this one (FIX-2087's closure walk) reuses them rather than
 * copying them.
 * FIX-2087's closure imports these `from`/`to` anchors for its `GOAL_CONTROL` legs: renaming one breaks that run too.
 */
import type { ModulePatch } from "../../lib/index.mts";

/** Each named control, by its `GOAL_CONTROL` name. */
export const PATCHES: Record<string, ModulePatch[]> = {
  // The sweeper fires no wake: only a fast path or a touch pays a debt. The
  // patch skips the fire of each due wake. The wake step still resumes waits
  // past their deadline (FIX-2082), a debt this goal does not grade.
  "no-sweeper-payment": [
    {
      module: "packages/engine/src/durability/durability-sweeper.ts",
      from: String.raw`      if \(fireWake === undefined\) continue;`,
      to: "      continue;"
    }
  ]
};
/** Leg b's second process dies the moment an ending's delivery would send a notice it owes. */
export const KILL_AFTER_ENDING: ModulePatch = {
  module: "packages/orchestration/src/tasks/notice/delivery.ts",
  // The first line of the delivery's send half, after the ending's write.
  from: String.raw`      const notices = owedNotices\(row, board\.collectionId, rows, filerOf\);`,
  to: '      if (process.env.GOAL_KILL === "after-ending" && Object.keys(row.metadata ?? {}).some((k) => k.startsWith("noticeOwed:"))) process.exit(0); const notices = owedNotices(row, board.collectionId, rows, filerOf);'
};
