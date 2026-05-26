/**
 * Capability-slot store adapter contract.
 *
 * `StoreAdapter` is the user-facing layer above the flat `StoreRegistry`.
 * A profile (`CapabilitySlotMap`) names which adapter backs each capability
 * slot — `primary` for the catch-all state, plus the forward-compatible
 * `blobs` / `queue` / `scheduler` slots. `createFlowState` resolves the
 * active profile into a concrete `StoreRegistry` (see `resolve-slots.ts`).
 *
 * Adapter packages (`store-postgres`, `store-sqlite`, `vercel/store`) import
 * these as types only and return plain objects whose shape satisfies
 * `StoreAdapter` — no runtime value crosses the package boundary, matching
 * the existing `import type { StoreRegistry }` pattern.
 */
import type { StoreRegistry } from "./types";

/**
 * Capability slots a profile can declare.
 *
 * - `primary` — required. The catch-all state slot: backs sessions, requests,
 *   users, orgs, active requests, checkpoints, content, and traces.
 * - `blobs` — binary object storage. Forward-compatible: declaring it is a
 *   no-op until a binary-aware blob store ships.
 * - `queue` — async work delivery. Forward-compatible.
 * - `scheduler` — wake-at-time-T scheduling. Forward-compatible.
 */
export interface CapabilitySlotMap {
  primary: StoreAdapter;
  blobs?: StoreAdapter;
  queue?: StoreAdapter;
  scheduler?: StoreAdapter;
}

/** A single capability slot name. */
export type CapabilitySlot = keyof CapabilitySlotMap;

/**
 * Named stores profiles. Each profile maps capability slots to the adapter
 * that backs them. At least one profile must be declared; single-profile
 * users typically use `{ default: ... }`.
 */
export type StoresConfig = Record<string, CapabilitySlotMap>;

/**
 * A tagged value an adapter factory returns. Declares which capability slots
 * it can back and realizes them on demand (opening pools, running schema
 * init) when `createFlowState` resolves the active profile.
 */
export interface StoreAdapter {
  /** Slots this adapter is willing to back. */
  readonly capabilities: ReadonlyArray<CapabilitySlot>;

  /**
   * Realize the adapter for the given slots. Returns the `StoreRegistry`
   * sub-stores it provides. Memoize internally so repeated resolution (e.g.
   * an adapter shared across slots) opens pools once.
   */
  resolve(slots: ReadonlyArray<CapabilitySlot>): Promise<Partial<StoreRegistry>>;

  /** Release pooled resources. Called by `FlowState.dispose()`. */
  dispose?(): Promise<void> | void;
}
