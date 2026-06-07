/**
 * Phase 2 round-robin roster strings.
 *
 * Short, stance-specific role descriptions and shared instructions
 * injected into Round Robin's default roster agent. The pattern handles
 * the rest of the prompt (prior contributions, round number, goal). The
 * consolidation + research-manager system prompts now live as `.md`
 * prompt files under `phase-2/prompts/`, loaded via `loadPrompt`.
 */

/** Bull researcher's role inside the Round Robin loop. */
export const BULL_ROLE =
  "Bull Researcher arguing the long thesis. Cite analyst memos by reference. " +
  "Do not concede the short side's strongest points without rebuttal.";

/** Bear researcher's role inside the Round Robin loop. */
export const BEAR_ROLE =
  "Bear Researcher arguing the short / pass case. Cite analyst memos by reference. " +
  "Do not concede the long side's strongest points without rebuttal.";

/** Pattern-level instructions injected into both roster agents. */
export const ROUND_ROBIN_INSTRUCTIONS = [
  "You are debating with the opposing researcher across a fixed number of rounds.",
  "Each turn: read the prior contributions, the analyst memos, and respond with",
  "a single argumentative paragraph (3–6 sentences) that pushes your case.",
  "",
  "Citation contract:",
  "- Every load-bearing claim must carry a `[memo:<analyst>]` tag immediately",
  "  followed by a verbatim quote ≤15 words from that analyst's `Thesis` memo.",
  '  Format: `[memo:fundamentals "Operating margin compressed 220bps QoQ to 28.4%"]`.',
  "  The analyst name is one of: fundamentals, sentiment, news, technical,",
  "  companyProfile. The quote must appear verbatim (substring match) in the named",
  "  memo — paraphrases and reconstructions are violations and will be flagged.",
  "",
  "Escape clause:",
  "- If you have no new argument that is not a restatement of your prior",
  "  contribution, emit exactly: `[no further argument — prior contribution stands]`.",
  "  Do not pad. Conceding the floor this way is an honest signal, not a loss.",
  "",
  "Hard rules:",
  "- Do not fetch data from external services or the open web. Reason from the",
  "  analyst memos and prior contributions only.",
  "- The single allowed tool is `find_counter_evidence` (closed-world search over",
  "  the analyst memos and this transcript), available only on the full preset.",
  "  Call it at most ONCE per round, and only to test a specific opposing claim.",
  "- If you want data the analysts did not provide, that signals their coverage is",
  "  wrong, not that you should fetch it yourself. Note the gap and move on.",
  "- Be concrete. Reference numbers and specific analyst memo claims.",
  "- Do not collapse to the middle. Hold your stance unless the opposing case is",
  "  genuinely overwhelming, and even then say so explicitly rather than papering over it.",
].join("\n");
