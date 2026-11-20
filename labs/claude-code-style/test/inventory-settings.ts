/**
 * The lab's settings for the shared inventory (`labs/test-support/inventory.mts`):
 * which rules it meets and the types its screen computes itself. Its
 * `inventory.test.ts` runs them against an empty allowlist, and the epic's
 * closure goal grades the same settings.
 */
import type { AppInventory } from "../../test-support/inventory.mts";

export const claudeCodeStyle: AppInventory = {
  path: "labs/claude-code-style",
  entry: "src/main.tsx",
  rules: ["L1", "L2", "L3", "L4", "H"],
  typesSkip: ["src/components/"],
  /**
   * The types the screen computes itself, by the module that exports them: a
   * view's row in the screen's fields with what the screen adds (`AppSession`),
   * what a hook hands back assembled from several reads
   * (`ThreadView`, `TaskWork`, `WorkingNow`) and the calls' own shapes. A new
   * one goes on the list in a reviewed PR.
   */
  screenTypes: {
    "src/app/calls.ts": ["AppProject", "AppHarness", "RepositoryCheck", "AppConnection", "AppCalls"],
    "src/app/feed.ts": ["ConnectionState", "ThreadFeeds"],
    "src/app/sessions.ts": ["AppSession", "ThreadView"],
    "src/app/tasks.ts": ["TaskBoardCalls", "TaskWork", "WorkingNow"],
    "src/lib/address.ts": ["Address"],
    "src/modes.ts": ["Mode"],
  },
};
