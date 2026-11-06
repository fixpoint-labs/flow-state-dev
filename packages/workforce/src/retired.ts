/**
 * Workforce's retired names: the one table this package refuses them from
 * (`@flow-state-dev/contracts/internal` → `retiredNames`). Each is a name a
 * published version accepted; the vocabulary sweep fails CI once the package
 * reaches an entry's `removeIn`.
 */
import { retiredNames } from "@flow-state-dev/contracts/internal";

export const REFUSALS = retiredNames("@flow-state-dev/workforce", {
  // The pre-built roster it took never reached a caller.
  agents: { replacement: "`roster` (the declared roster) and `inventory` (the live inventory collection keys)", removeIn: "0.7.0" },
  // Nothing ever read it.
  catalog: { replacement: "defineAgentWorkerFlow({ catalog }), where a tool catalog reaches a worker flow", removeIn: "0.7.0" }
});
