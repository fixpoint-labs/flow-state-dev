/**
 * Orchestration's retired names: the one table this package refuses and reads
 * them from (`@flow-state-dev/contracts/internal` → `retiredNames`). Each is a
 * name a published version accepted or wrote; the vocabulary sweep fails CI
 * once the package reaches an entry's `removeIn`.
 *
 * Entry points look up only the names they accept (`only`), from the lists
 * below: the board its options, the collection factory its backings.
 */
import { retiredNames } from "@flow-state-dev/contracts/internal";

export const REFUSALS = retiredNames("@flow-state-dev/orchestration", {
  // ── taskBoard options
  // Dropped silently, a board would lose its claim order and any guard in it.
  dispatcher: { replacement: '`claimOrder`, with the same claim order (or "fifo", "topological", "priority")', removeIn: "0.8.0" },
  onReview: {
    replacement:
      'nothing on the board: a worker\'s question keeps its task waiting (`holdTaskForUser`), a review suspends its run (`ctx.suspendForUser({ kind: "review" })`), and a board whose only open rows wait on a person exits `blocked` on its own',
    removeIn: "0.8.0"
  },

  // ── getOrCreateTaskCollection backings
  sequencer: { replacement: 'backing: "state", and pass the ref as `state`', removeIn: "0.8.0" },
  request: { replacement: 'backing: "state" with no `state` field, to keep tasks on the request', removeIn: "0.8.0" },

  // ── SKILL.md keys
  // Preserved, it would round-trip a team nothing runs; dropped, the body could ask for one silently.
  agents: { replacement: "the task board: delegate to workers there, and delete the `agents:` block", removeIn: "0.8.0" },

  // ── stored task rows
  // `blocked` and `held` mean the same: filed, not started, until someone says go.
  blocked: { replacement: '"held"', readAs: "held", removeIn: "0.8.0" }
});

/** The retired `taskBoard` options. */
export const BOARD_OPTIONS = ["onReview", "dispatcher"] as const;

/** The retired `getOrCreateTaskCollection` backings. */
export const COLLECTION_BACKINGS = ["sequencer", "request"] as const;
