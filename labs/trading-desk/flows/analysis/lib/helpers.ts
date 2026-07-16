/**
 * App-level helpers shared across phases. Each one is a 1–3 line shape
 * the code reads a lot — pulling them out of generators / analysts keeps
 * the block files about block composition, not text mechanics.
 */
import type { BlockDefinition } from "@flow-state-dev/core";
import { AGENTS, type AgentName } from "../registry";
import type { SessionState } from "../state";

/**
 * Reshape an upstream input to the `{ ticker, date }` shape every Phase 1
 * tool block expects. Used as the `.map` step right before a parallel
 * tool fan-out. Ctx is permissive because the sequencer's pre-`.map` step
 * doesn't carry the `tradingDesk` capability's session-state typing yet;
 * the values are runtime-validated by each tool's input schema downstream.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tickerDate(_input: unknown, ctx: any): { ticker: string; date: string } {
  const state = ctx.session.state as SessionState;
  return { ticker: state.ticker, date: state.date };
}

/**
 * Render an arbitrary data bundle as a fenced JSON block. Used by the
 * analyst generators' `context.data` slot so the LLM reads its pre-fetched
 * data as one cohesive payload rather than as scattered tags.
 */
export function asDataBlock(data: unknown): string {
  return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
}

/** The transcript label shown on the per-analyst card. */
export function memoLabel(name: AgentName): string {
  return `${AGENTS[name].role} memo`;
}

/**
 * Tag every block in a `.parallel` tool record with an
 * `itemVisibility: { client: true, history: false }` + `agentName`
 * attribution so the transcript pills attach to the right analyst card.
 * Replaces the per-analyst IIFE that bound `.asTool()` over each tool entry.
 *
 * @example
 *   .parallel(attributedTools("fundamentalsAnalyst", {
 *     balanceSheet: get_balance_sheet,
 *     incomeStatement: get_income_statement,
 *   }))
 */
export function attributedTools<R extends Record<string, BlockDefinition>>(
  agentName: AgentName,
  tools: R,
): Record<keyof R, BlockDefinition> {
  const result: Record<string, BlockDefinition> = {};
  for (const [key, block] of Object.entries(tools)) {
    result[key] = block.asTool({ itemVisibility: { client: true, history: false }, agentName });
  }
  return result as Record<keyof R, BlockDefinition>;
}
