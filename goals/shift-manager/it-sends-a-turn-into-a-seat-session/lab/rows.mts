/**
 * The two rows the goal's DevTeam files for the coder at boot: one for the
 * task composer, and a second running beside it that the line must not reach.
 * Read by the Lab and by the check, which finds each by its issue.
 */
export const ROWS = [
  { issue: "TURN-1", goal: "Add the greeting module." },
  { issue: "TURN-2", goal: "Add the farewell module." },
] as const;

/**
 * Where the goal's DevTeam keeps its store: a SQLite file the check reads
 * the board's stored rows from. The retry counters a row carries are not in
 * the board's browser view, so the check reads them where they are stored.
 */
export const STORE_ENV = "TURN_GOAL_STORE";

/** What the goal's scripted EM turn answers any line with: it names no feature, so nothing was filed. */
export const EM_ANSWER = "Nothing filed: that line names no feature.";
