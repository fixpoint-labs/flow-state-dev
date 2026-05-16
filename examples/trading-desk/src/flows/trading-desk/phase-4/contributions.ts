/**
 * Phase 4 round-robin contributions resource — declared in its own leaf
 * module so the `tradingDesk` capability can import the resource ref
 * without triggering a circular import via `round-robin.ts → personas.ts
 * → trading-desk-capability.ts`.
 */
import { createRoundRobinContributions } from "@flow-state-dev/patterns/round-robin";

export const phase4Contributions = createRoundRobinContributions();
