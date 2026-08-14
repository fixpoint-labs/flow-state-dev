/**
 * The deterministic driver: gate derivation, the `decide` reducer, and the
 * reconciler that turns a divergence between conductor's copy and the world
 * into ordered signals.
 *
 * Pure and synchronous throughout. The composition is:
 *
 * ```
 * observed + fresh ──reconcile()──▶ Signal[] ──decide() per signal──▶ Action[]
 * ```
 */

export * from "./decide";
export * from "./derive-gate";
export * from "./reconcile";
