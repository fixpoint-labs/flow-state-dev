/**
 * The runtime — the tick, and the durable state it runs against.
 *
 * Everything else in this package is a piece: the model says what is stored,
 * the driver decides, the two seams read the world and do the work. This
 * directory is what puts them in an order and gives the result somewhere to
 * live.
 *
 * ```
 * openConductor({ config, statePath })      ./session
 *        │
 *        ├─ manage / read / tick
 *        │       └─ observe → decide → execute → ledger      ./tick
 *        │
 *        └─ collections, addressed by declared scope         ./collections
 *                 └─ records under statePath                 ./store
 * ```
 */

export {
  openConductor,
  type ConductorSession,
  type EpicWorkItem,
  type IssueWorkItem,
  type OpenConductorInput,
  type WorkItem,
} from "./session";

export {
  ConductorNotManagedError,
  mintSessionId,
  type ManagedWork,
  type TickContext,
} from "./tick";

export type { RuntimeDeps } from "./deps";

export {
  addressFor,
  collectionHandle,
  conductorCollections,
  type CollectionHandle,
  type ConductorCollections,
  type ConductorScopeIds,
} from "./collections";

export {
  ConductorStateError,
  fileStateStore,
  type ConductorScope,
  type ScopeAddress,
  type StateRecord,
  type StateStore,
  type StoredRecord,
} from "./store";
