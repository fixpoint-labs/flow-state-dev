/**
 * Scheduled's retired names: the one table this package refuses them from
 * (`@flow-state-dev/contracts/internal` → `retiredNames`). Each is a name a
 * published version accepted; the vocabulary sweep fails CI once the package
 * reaches an entry's `removeIn`.
 */
import { retiredNames } from "@flow-state-dev/contracts/internal";

export const REFUSALS = retiredNames("@flow-state-dev/scheduled", {
  idempotencyWindowMs: {
    drop: "each scheduled time fires at most once, recorded in the host's store, so there is no window to set",
    removeIn: "0.6.0"
  },
  idempotencyOptions: { drop: "the per-process cache it configured is gone", removeIn: "0.6.0" }
});
