/**
 * `defineLensGenerator(lens)` — per-lens verdict generator factory (BP-024).
 *
 * The lenses differ ONLY by identity (the persona text + agentName + lens id);
 * the recipe (read the post-Phase-2 bundle, emit `lensVerdictOutputSchema`) is
 * identical, so this is the textbook factory case (like `defineAnalyst`).
 *
 * Each instance:
 *  - reads the SAME post-Phase-2 evidence bundle (synthesized investment thesis
 *    + Phase 1 analyst memos + valuation spine). All lenses read this; NONE
 *    reads another lens (independence = honesty, FIX-655). There is no shared
 *    `activeLensId` — the persona is injected via a per-generator `context` slot
 *    that closes over the literal lens, so each lens is BLIND to the others
 *    regardless of execution order (BUILD_PLAN §7 / real-money gate §1.5). The
 *    steps are chained sequentially in `index.ts` (a runtime read-back
 *    constraint — see that file's header), which does not change the blindness:
 *    a lens's prompt context never includes another lens's output.
 *  - injects the lens's documented methodology via the `<lens>` context tag plus
 *    a fixed framing clause: "applying X's documented methodology … not a claim
 *    about what X thinks today, and not financial advice" (real-money gate §1.7).
 *  - emits a `TxStruct` card (`itemVisibility.history: true`) so each lens shows
 *    in the transcript like any structured agent.
 *
 * Deliberate deviation from the Phase 3–5 preamble convention: lenses do NOT get
 * a `createApproachGenerator()` preamble — a preamble per lens would 4× the
 * transcript noise for a lean second-opinion pass. Lenses emit their card
 * directly.
 */
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { PHASE_2B_MEMO_KEYS } from "../../registry";
import { tradingDesk } from "../../capability";
import type { InvestorLens } from "./lenses";
import { loadPrompt } from "../../lib/prompt";
import { sessionStateSchema } from "../../state";
import { lensVerdictOutputSchema } from "./lens-verdict-schema";

const lensPrompt = loadPrompt("agents/lenses/prompts/lens.prompt.md");

/** Render the lens's documented methodology as the `<lens>` prompt block. The
 *  framing clause (documented methodology / not advice) leads so the model is
 *  bound by it before reasoning. */
function formatLens(lens: InvestorLens): string {
  return [
    `You are applying ${lens.attribution} to the evidence below. This is documented`,
    // Use the documented-investor name, not a first-name slice: attribution is
    // "<name> documented methodology" where the name may be multi-word ("Howard
    // Marks") or a pair ("Buffett / Munger"), so strip the suffix rather than
    // taking split(" ")[0] (which produced a bare, ambiguous "Howard").
    `methodology — NOT a claim about what ${lens.attribution.replace(" documented methodology", "")} thinks today, and`,
    `NOT financial advice. Produce an independent verdict in this lens's voice.`,
    "",
    `Lens: ${lens.label} (id: ${lens.id})`,
    "",
    "Core principles:",
    ...lens.corePrinciples.map((p) => `- ${p}`),
    "",
    "Characteristic questions you ask:",
    ...lens.characteristicQuestions.map((q) => `- ${q}`),
    "",
    "What you over-weight in the evidence:",
    ...lens.weights.map((w) => `- ${w}`),
    "",
    "What disqualifies the position regardless of upside:",
    ...lens.disqualifiers.map((d) => `- ${d}`),
    "",
    `Horizon: ${lens.horizon}`,
    `Sizing philosophy: ${lens.sizingPhilosophy}`,
    "",
    `Metrics this methodology normally relies on: ${lens.dataDependencies.join(", ")}.`,
    "If one of these is absent from the bundle, say so in `dataGap` / `missingData`",
    "and reason from what you DO have — never invent the number (BP-020).",
  ].join("\n");
}

/** Build one lens-verdict generator for a persona. */
export function defineLensGenerator(lens: InvestorLens) {
  return generator({
    name: `lens-${lens.id}-generator`,
    itemVisibility: { client: true, history: true },
    agentName: PHASE_2B_MEMO_KEYS[lens.id as keyof typeof PHASE_2B_MEMO_KEYS].agentName,
    uses: [
      tradingDesk.presets({
        // The post-Phase-2 evidence bundle — the synthesized thesis + the
        // analyst memos + the valuation spine. SAME bundle for every lens.
        investmentThesis: true,
        phase1MemosFull: true,
        valuationSpine: true,
        highReasoning: true,
      }),
    ],
    // Per-generator context closes over THIS lens's persona — the parallel,
    // blind-to-each-other injection point (no shared session state).
    context: {
      lens: () => formatLens(lens),
    },
    ...definePromptFile(lensPrompt),
    sessionStateSchema,
    outputSchema: lensVerdictOutputSchema,
  });
}
