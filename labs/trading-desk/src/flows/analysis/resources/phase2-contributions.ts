/**
 * Phase 2 round-robin contributions resource. Created as a free resource ref
 * (no surrounding collection) so the bull/bear round-robin can share its
 * transcript with the three post-loop consolidation generators and with the
 * `tradingDesk` capability's stance/debate presets.
 *
 * Lives in its own resources module so importers (the round-robin instance,
 * the capability, the flow registration) all pull from one place — keeping the
 * import graph cycle-free without a per-phase leaf module.
 */
import { createRoundRobinContributions } from "@flow-state-dev/patterns/round-robin";

export const phase2Contributions = createRoundRobinContributions();
