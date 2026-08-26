/**
 * Which agents the Theses tab routes to a dedicated memo renderer.
 *
 * Every set is DERIVED from its phase registry, never hand-maintained, so a
 * participant added to a phase is routed by construction. Adding a sixth
 * dedicated renderer means adding a set the same way — never an `agent === "..."`
 * literal in the dispatcher.
 *
 * The sets must stay DISJOINT: `MemoDoc` tests them as an ordered if-chain, so an
 * agent in two sets is drawn by whichever arm comes first and the other card
 * silently never renders for it. `test/memo-renderer-routing.spec.ts` asserts
 * both properties.
 *
 * A plain module rather than exports on `theses-pane.tsx`, so the routing rule is
 * assertable without importing a React component file — the
 * `memo-step-coverage.spec.ts` precedent of testing against the registry.
 */
import {
  LENS_IDS,
  PHASE_2B_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
  type AgentName,
} from "@/flows/analysis/registry";

/** The four phase-2b lens agents. A `published` memo for one of these renders as
 *  a `LensCard` rather than the generic memo doc. */
export const LENS_AGENTS: ReadonlySet<AgentName> = new Set(
  LENS_IDS.map((id) => PHASE_2B_MEMO_KEYS[id].agentName),
);

/** The phase-3 trade participant, whose memo renders as a
 *  `TraderProposalCard`. */
export const TRADER_AGENTS: ReadonlySet<AgentName> = new Set(
  Object.values(PHASE_3_MEMO_KEYS).map((entry) => entry.agentName as AgentName),
);

/** The four phase-4 risk participants (three persona critiques + the
 *  consolidated assessment), whose memos render as a `RiskCritiqueCard` — which
 *  picks its own variant off the agent. */
export const RISK_AGENTS: ReadonlySet<AgentName> = new Set(
  Object.values(PHASE_4_MEMO_KEYS).map((entry) => entry.agentName as AgentName),
);
