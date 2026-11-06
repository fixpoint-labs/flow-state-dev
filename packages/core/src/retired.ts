/**
 * Core's retired names: the one table this package refuses them from
 * (`@flow-state-dev/contracts/internal` → `retiredNames`). Each is a name a
 * published version accepted; the vocabulary sweep fails CI once the package
 * reaches an entry's `removeIn`.
 */
import { retiredNames } from "@flow-state-dev/contracts/internal";

export const REFUSALS = retiredNames("@flow-state-dev/core", {
  // A three-part model string: the gateway's name, then the provider's model.
  "gateway/provider/model": { replacement: 'a named route with a colon, "gateway:provider/model"', removeIn: "0.7.0" }
});
