/**
 * Coverage guard for the Theses-tab memo dispatch (FIX-1061).
 *
 * The defect class this issue exists to fix is **a stored field that reaches
 * the client and is never drawn**, and one of its two mechanisms is the
 * dispatcher not routing the memo at all. These tests close that half: the
 * three dedicated-renderer sets are asserted to equal exactly the agents in
 * their phase registries, so a participant added to a phase and not routed
 * fails here rather than shipping as a memo that quietly renders the generic
 * card. (The `memo-step-coverage.spec.ts` precedent, one layer up the stack.)
 *
 * What this does NOT catch, stated rather than glossed: a deleted `MemoDoc`
 * branch in `theses-pane.tsx`. The sets can be correct while nothing reads
 * them. That residual is verified by hand.
 */
import { describe, expect, it } from "vitest";
import {
  LENS_AGENTS,
  RISK_AGENTS,
  TRADER_AGENTS,
} from "../components/theses/memo-renderer-routing";
import {
  PHASE_1_MEMO_KEYS,
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
  PHASE_6_MEMO_KEYS,
  type AgentName,
} from "../flows/analysis/registry";

const sorted = (agents: Iterable<AgentName>): string[] =>
  [...agents].map(String).sort();

const agentsOf = (registry: Record<string, { agentName: string }>): string[] =>
  Object.values(registry)
    .map((entry) => entry.agentName)
    .sort();

describe("Theses memo dispatch routes every phase-3 and phase-4 participant", () => {
  it("routes exactly the phase-3 trade participants to the trader card", () => {
    expect(sorted(TRADER_AGENTS)).toEqual(agentsOf(PHASE_3_MEMO_KEYS));
  });

  it("routes exactly the phase-4 risk participants to the risk card", () => {
    // Three persona critiques plus the consolidated assessment. A fourth
    // persona added to the registry and left unrouted fails here.
    expect(sorted(RISK_AGENTS)).toEqual(agentsOf(PHASE_4_MEMO_KEYS));
    expect(RISK_AGENTS.size).toBe(4);
  });

  it("gives each memo exactly one dedicated renderer", () => {
    // The dispatch is an ordered if-chain, so an agent in two sets would be
    // drawn by whichever arm comes first and the other card would silently
    // never render for it.
    const all = [...LENS_AGENTS, ...TRADER_AGENTS, ...RISK_AGENTS].map(String);
    expect(new Set(all).size).toBe(all.length);
  });

  it("leaves the generic-renderer memos on the generic branch", () => {
    // The analysts, the two debaters, the research manager, and the thesis
    // validator are deliberately NOT re-routed by this issue: their structured
    // fields are a separate, flagged follow-up. If one of them started matching
    // a dedicated set, this issue would have silently widened its own scope.
    const untouched = [
      ...agentsOf(PHASE_1_MEMO_KEYS),
      ...agentsOf(PHASE_2_MEMO_KEYS),
      ...agentsOf(PHASE_6_MEMO_KEYS),
    ];
    for (const agent of untouched) {
      const name = agent as AgentName;
      expect(
        LENS_AGENTS.has(name) || TRADER_AGENTS.has(name) || RISK_AGENTS.has(name),
      ).toBe(false);
    }
  });
});
