/**
 * Phase 1 memo state-transition blocks — `markWriting`, `commitMemo`,
 * `markError`. Built via the shared `defineMemoWriter` factory; this file
 * supplies only what's specific to Phase 1: the keys registry, the agent
 * team, and the commit projection that flattens the LLM's array-of-pairs
 * `metrics` shape (required by OpenAI strict structured outputs) back
 * into the stored `Record<string,string>` shape.
 */
import { defineMemoWriter } from "../lib/memo-writer";
import { PHASE_1_MEMO_KEYS, type Phase1MemoShortName } from "../agents";
import { thesisOutputSchema } from "./thesis-schema";

const writer = defineMemoWriter({
  phaseId: "p1",
  agentTeam: "analyst",
  keys: PHASE_1_MEMO_KEYS,
  errorMessageFallback: "Analyst run failed.",
});

export const { markWriting, markError } = writer;

/**
 * Commit an analyst's `Thesis` to its memo. The `metrics` array-of-pairs
 * is flattened back into a `Record<string,string>` — the LLM emits the
 * pair shape (OpenAI strict-mode requirement) and the stored shape is
 * the dict.
 */
export function commitMemo(shortName: Phase1MemoShortName) {
  return writer.defineCommit({
    shortName,
    inputSchema: thesisOutputSchema,
    project: (thesis) => ({
      label: thesis.label,
      headline: thesis.headline,
      rating: thesis.rating,
      body: thesis.body,
      metrics: Object.fromEntries(thesis.metrics.map((m) => [m.key, m.value])),
      citations: thesis.citations,
    }),
  });
}
