/**
 * `defineAnalyst` — Phase 1 analyst sub-sequencer factory.
 *
 * Every Phase 1 analyst follows the same five-step recipe:
 *
 *   .tap(markWriting)              // pre-mark memo + stamp startedAt
 *   .map(tickerDate)               // reshape to { ticker, date } from session state
 *   .parallel(attributedTools)     // fan-out the role's tools, attributed
 *   .then(generator)               // synthesize the Thesis
 *   .tap(commitMemo)               // publish memo + flip status
 *   .rescue([markError])           // localized failure handling
 *
 * The factory captures the recipe; the call site supplies what varies:
 * the memo short-name, the tool record, and the generator. Each analyst
 * becomes ~5 lines.
 */
import { sequencer, type BlockDefinition } from "@flow-state-dev/core";
import { PHASE_1_MEMO_KEYS, type Phase1MemoShortName } from "../agents";
import { attributedTools, memoLabel, tickerDate } from "../lib/helpers";
import { commitMemo, markError, markWriting } from "./writer";

/** Convert camelCase to kebab-case for sequencer names. */
function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export interface AnalystConfig {
  /** Phase-1 memo short-name — drives the sequencer name, the agentName
   *  used to attribute tool pills, and the memo key the writer resolves. */
  shortName: Phase1MemoShortName;
  /** Tools fanned out in parallel. Each value is decorated with
   *  `.asTool({ agentType: "sub", agentName })` before being placed in
   *  the parallel record so transcript pills attribute to this analyst. */
  tools: Record<string, BlockDefinition>;
  /** The role-specific synthesis generator. Its `inputSchema` must match
   *  the shape of the parallel tools record (`{ [key]: toolOutput }`). */
  generator: BlockDefinition;
}

/**
 * Build a Phase 1 analyst sub-sequencer. Returns the assembled sequencer
 * ready to be placed in the phase-1 fan-out `.parallel({...})` record.
 */
export function defineAnalyst(config: AnalystConfig): BlockDefinition {
  const { shortName, tools, generator } = config;
  const { agentName } = PHASE_1_MEMO_KEYS[shortName];
  return sequencer({
    name: `analyst-${kebab(shortName)}`,
    container: { component: "analyst-card", label: memoLabel(agentName) },
  })
    .tap(markWriting(shortName))
    .map(tickerDate)
    .parallel(attributedTools(agentName, tools))
    .then(generator)
    .tap(commitMemo(shortName))
    .rescue([{ block: markError(shortName) }]);
}
