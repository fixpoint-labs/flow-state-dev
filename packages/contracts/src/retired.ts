/**
 * Contracts' retired names: the one table this package refuses and reads them
 * from (`@flow-state-dev/contracts/internal` → `retiredNames`).
 *
 * The suspension reasons said `human` through core 0.2.0, which stored them
 * durably, so a stop waiting in an adopter's store can carry one. A stored one
 * reads as a user's stop (`isUserSuspension`); a new `ctx.suspend` or a
 * `useSuspensions` filter with one is refused.
 */
import { retiredNames } from "./retired-names";

export const REFUSALS = retiredNames("@flow-state-dev/contracts", {
  human_approval: { replacement: '"user_approval"', readAs: "user_approval", removeIn: "0.6.0" },
  human_input: { replacement: '"user_input"', readAs: "user_input", removeIn: "0.6.0" }
});
