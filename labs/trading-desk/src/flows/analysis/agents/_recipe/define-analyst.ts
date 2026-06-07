/**
 * `defineAnalyst` — Phase 1 analyst factory, now a thin wrapper over
 * `defineMemoStep`.
 *
 * Every Phase 1 analyst follows the same memo lifecycle as every other
 * participant — `markWriting → body → commit → rescue(markError)`. The only
 * analyst-specific content is the pre-commit BODY: reshape session state to
 * `{ ticker, date }`, fan the role's tools out in parallel (attributed so the
 * transcript pills attach to this analyst), then synthesize the Thesis. That
 * body is composed here and handed to `defineMemoStep`, which owns the
 * lifecycle — so the analyst recipe is no longer a separate apparatus, just a
 * body-composition + delegation.
 *
 * The body sequencer keeps the `analyst-card` container so the per-analyst card
 * item still streams (the label is the analyst's `<role> memo`), and the
 * analyst-named sequencer survives as the body's name.
 */
import { sequencer, type BlockDefinition } from "@flow-state-dev/core";
import { PHASE_1_MEMO_KEYS, type Phase1MemoShortName } from "../../registry";
import { attributedTools, memoLabel, tickerDate } from "../../lib/helpers";
import { commitAnalystMemo } from "../analysts/writer";
import { defineMemoStep } from "./memo-writer";

/** Convert camelCase to kebab-case for sequencer names. */
function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export interface AnalystConfig {
  /** Phase-1 memo short-name — drives the sequencer name, the agentName
   *  used to attribute tool pills, the `analyst-card` container label, and
   *  the memo key `defineMemoStep` resolves identity from. */
  shortName: Phase1MemoShortName;
  /** Tools fanned out in parallel. Each value is decorated with
   *  `.asTool({ itemVisibility: { client: true, history: false }, agentName })` before being placed in
   *  the parallel record so transcript pills attribute to this analyst. */
  tools: Record<string, BlockDefinition>;
  /** The role-specific synthesis generator. Its `inputSchema` must match
   *  the shape of the parallel tools record (`{ [key]: toolOutput }`). */
  generator: BlockDefinition;
}

/**
 * Build a Phase 1 analyst step. Composes the analyst body (tool fan-out →
 * synthesis generator, under the `analyst-card` container) and delegates the
 * memo lifecycle to `defineMemoStep`. Returns the assembled step ready to be
 * placed in the phase-1 fan-out `.parallel({...})` record.
 */
export function defineAnalyst(config: AnalystConfig): BlockDefinition {
  const { shortName, tools, generator } = config;
  const { agentName } = PHASE_1_MEMO_KEYS[shortName];
  const body = sequencer({
    name: `analyst-${kebab(shortName)}`,
    container: { component: "analyst-card", label: memoLabel(agentName) },
  })
    .map(tickerDate)
    .parallel(attributedTools(agentName, tools))
    .step(generator);
  return defineMemoStep(body, { key: shortName, commit: commitAnalystMemo(shortName) });
}
