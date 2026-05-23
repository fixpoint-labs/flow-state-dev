/**
 * Phase 2 memo state-transition blocks — built via the shared
 * `defineMemoWriter` factory. The three commits differ only in their
 * input schema; the research-manager commit adds the InvestmentThesis
 * extension fields (`stance`, `conviction`, `keyRisks`, …) that Phase 3+
 * read directly off the memo.
 */
import { defineMemoWriter } from "../lib/memo-writer";
import { PHASE_2_MEMO_KEYS } from "../agents";
import {
  bearThesisOutputSchema,
  bullThesisOutputSchema,
  investmentThesisOutputSchema,
} from "./generators";

const writer = defineMemoWriter({
  phaseId: "p2",
  agentTeam: "research",
  keys: PHASE_2_MEMO_KEYS,
  errorMessageFallback: "Phase 2 generator failed.",
});

export const { markWriting: markWritingP2, markError: markErrorP2 } = writer;

export const commitBullMemo = writer.defineCommit({
  shortName: "bull",
  inputSchema: bullThesisOutputSchema,
  project: (thesis) => ({
    label: thesis.label,
    headline: thesis.headline,
    rating: thesis.rating,
    body: thesis.body,
    metrics: thesis.metrics,
  }),
});

export const commitBearMemo = writer.defineCommit({
  shortName: "bear",
  inputSchema: bearThesisOutputSchema,
  project: (thesis) => ({
    label: thesis.label,
    headline: thesis.headline,
    rating: thesis.rating,
    body: thesis.body,
    metrics: thesis.metrics,
  }),
});

export const commitResearchManagerMemo = writer.defineCommit({
  shortName: "researchManager",
  inputSchema: investmentThesisOutputSchema,
  project: (thesis) => ({
    label: thesis.label,
    headline: thesis.headline,
    rating: thesis.rating,
    body: thesis.body,
    metrics: thesis.metrics,
    stance: thesis.stance,
    conviction: thesis.convictionScore,
    keyRisks: thesis.keyRisks,
    keyOpportunities: thesis.keyOpportunities,
    unresolvedDisagreements: thesis.unresolvedDisagreements,
  }),
});
