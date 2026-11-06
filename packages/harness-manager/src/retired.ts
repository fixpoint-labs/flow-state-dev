/**
 * Harness-manager's retired names: the one table this package refuses them
 * from (`@flow-state-dev/contracts/internal` → `retiredNames`). Each is a name
 * a published version accepted; the vocabulary sweep fails CI once the package
 * reaches an entry's `removeIn`.
 */
import { retiredNames } from "@flow-state-dev/contracts/internal";

export const REFUSALS = retiredNames("@flow-state-dev/harness-manager", {
  // A host that still passes it expects to be told of each question; dropping
  // it silently would leave that host waiting on a call that never comes.
  announce: {
    replacement:
      "the board: a run's question keeps its task waiting there, where the Inbox lists it; read held tasks with `openRowHolds`",
    removeIn: "0.7.0"
  }
});
