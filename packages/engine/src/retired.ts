/**
 * Engine's retired names: the one table this package refuses them from
 * (`@flow-state-dev/contracts/internal` → `retiredNames`). Each is a name a
 * published version accepted; the vocabulary sweep fails CI once the package
 * reaches an entry's `removeIn`.
 */
import { retiredNames } from "@flow-state-dev/contracts/internal";

export const REFUSALS = retiredNames("@flow-state-dev/engine", {
  // A caller that is not type-checked, or spreads an older config object,
  // would otherwise have its queue runner silently dropped and its work run in
  // process.
  dispatcher: { replacement: "`runner`, with the same FlowRunner", removeIn: "0.7.0" }
});
