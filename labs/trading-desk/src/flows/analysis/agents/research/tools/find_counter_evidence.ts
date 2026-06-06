/**
 * `find_counter_evidence` — closed-world counter-evidence search (FIX-679).
 *
 * A debater tool that surfaces evidence AGAINST a claim from inside the
 * desk's own context: the named analyst memo and the running Phase 2
 * transcript. It deliberately does NOT touch the open web. The audit
 * rejected open-web fetch for Bull/Bear (asymmetry risk: whichever side
 * fetches more "wins" on appearance), so this primitive holds context
 * constant across debaters and only re-surfaces what the analysts already
 * established.
 *
 * Search is naive keyword overlap plus substring containment — no LLM, no
 * ranking model. The claim is tokenized into content words; memo sections
 * and prior contributions that share the most tokens (or contain the claim
 * verbatim) are returned, capped at three, each excerpt trimmed to 200
 * chars. Exposed only on `costPreset === "full"` via the `counterEvidence`
 * capability preset.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_1_MEMO_KEYS, type Phase1MemoShortName } from "../../../registry";
import { memoSectionTexts } from "../../../lib/format";
import { memosCollection } from "../../../resources/memos";
import { phase2Contributions } from "../../../resources/phase2-contributions";
import type { RoundRobinContributionEntry } from "@flow-state-dev/patterns/round-robin";

/** Searchable analyst memos, derived from the Phase 1 registry so a sixth
 *  analyst is picked up automatically. */
const ANALYST_KEYS = Object.keys(PHASE_1_MEMO_KEYS) as [
  Phase1MemoShortName,
  ...Phase1MemoShortName[],
];

const MAX_MATCHES = 3;
const EXCERPT_LIMIT = 200;

/** Drop short / high-frequency words so overlap scores reflect the claim's
 *  content, not its connective tissue. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "to", "of", "in", "on", "for", "with", "as", "at", "by", "that",
  "this", "it", "its", "from", "has", "have", "had", "will", "would", "not",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.%]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

type Candidate = { source: string; text: string };

/** Score a candidate by distinct claim-keyword overlap, with a strong bonus
 *  when the candidate contains the claim verbatim. The verbatim bonus is
 *  `claimTokens.size + 1` so a verbatim hit always scores ≥1 even when the
 *  claim is entirely stopwords/short tokens (empty token set). Zero means no
 *  match. */
function score(candidate: string, claimTokens: Set<string>, claim: string): number {
  const lower = candidate.toLowerCase();
  let overlap = 0;
  for (const token of claimTokens) {
    if (lower.includes(token)) overlap++;
  }
  if (lower.includes(claim.toLowerCase())) overlap += claimTokens.size + 1;
  return overlap;
}

function trim(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > EXCERPT_LIMIT ? `${clean.slice(0, EXCERPT_LIMIT)}…` : clean;
}

export const find_counter_evidence = handler({
  name: "find_counter_evidence",
  description:
    "Closed-world search for evidence against a specific claim. Searches the " +
    "named analyst memo and the current Phase 2 debate transcript only. Does " +
    "NOT access the open web. Returns up to 3 counter-evidence excerpts.",
  inputSchema: z.object({
    claim: z.string().min(10),
    opposingMemo: z.enum(ANALYST_KEYS),
  }),
  outputSchema: z.object({
    matches: z.array(
      z.object({
        source: z.string(),
        excerpt: z.string(),
      }),
    ),
  }),
  resources: { memos: memosCollection, p2Contributions: phase2Contributions },
  execute: async (input, ctx) => {
    const claimTokens = new Set(tokenize(input.claim));
    const candidates: Candidate[] = [];

    // 1. The opposing analyst memo, one candidate per body section.
    const memoState = (
      await ctx.resources.memos.getOptional(
        PHASE_1_MEMO_KEYS[input.opposingMemo].collectionKey,
      )
    )?.state;
    for (const text of memoSectionTexts(memoState)) {
      candidates.push({ source: `memo:${input.opposingMemo}`, text });
    }

    // 2. Prior debate contributions, one candidate per turn.
    const entries: RoundRobinContributionEntry[] =
      ctx.resources.p2Contributions.state.entries ?? [];
    for (const entry of entries) {
      candidates.push({
        source: `contribution:${entry.agentName}:r${entry.round}`,
        text: entry.text,
      });
    }

    const matches = candidates
      .map((c) => ({ ...c, s: score(c.text, claimTokens, input.claim) }))
      .filter((c) => c.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_MATCHES)
      .map((c) => ({ source: c.source, excerpt: trim(c.text) }));

    return { matches };
  },
});
