/**
 * `tradingDesk` capability — the single capability every generator in the
 * trading-desk pipeline lists in its `uses` slot.
 *
 * What it provides:
 *
 *   1. **Model selection** — the `core` preset (default-on) chooses
 *      `intent/chat` when `costPreset === "full"`, else `intent/utility`.
 *      Generators no longer carry per-block `model:` slots.
 *
 *   2. **Always-on context** — the same `core` preset injects
 *      `<ticker>`, `<date>`, and `<userInstructions>` tags from session
 *      state and the user-scoped special-instructions resource into every
 *      generator's prompt. No per-generator boilerplate. The
 *      `<userInstructions>` tag is auto-suppressed when both the global
 *      and active-phase fields are empty (FIX-603).
 *
 *   3. **Opt-in context bundles** — named presets that inject specific
 *      memo, contribution, or debate-transcript context tags. Generators
 *      opt in via `tradingDesk.presets({ phase1Memos: true, ... })`.
 *      Each bundle also declares the resources it reads, so consumers
 *      don't have to mirror that in their own `resources:` slot.
 *
 *   4. **Cost-preset gating lives in the preset, not the call site.**
 *      `*Full` variants (e.g. `phase1MemosFull`, `phase2DebateFull`,
 *      `riskCritiquesFull`) render an empty string when
 *      `costPreset !== "full"`. Generators that want full-only context
 *      list the `*Full` variant directly in `uses` rather than wrapping
 *      a dynamic `uses` lambda around the always-on preset — the static
 *      shape lets resources flow through and keeps the call site flat.
 */
import { defineCapability } from "@flow-state-dev/core";
import {
  fetch as createFetchTool,
  search as createSearchTool,
} from "@flow-state-dev/tools";
import { find_counter_evidence } from "./agents/research/tools/find_counter_evidence";
import {
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
  PHASE_5_MEMO_KEYS,
} from "./registry";
import { memosCollection, phase2Contributions } from "./resources";
import { valuationSpineResource } from "./valuation-spine-resource";
import { rewardToRiskResource } from "./reward-to-risk-resource";
import { lensConvergenceResource } from "./agents/lenses/lens-convergence-resource";
import {
  formatValuationSpine,
  formatRatingEnvelope,
} from "./lib/valuation-spine";
import { formatUserInstructions } from "./special-instructions";
import { specialInstructionsResource } from "./special-instructions-resource";
import { sessionStateSchema, type SessionState } from "./state";
import {
  formatAnalystMemos,
  formatCitationIntegrity,
  formatDebate,
  formatLensConvergence,
  formatMemoBlock,
  formatPersonaCritique,
  formatPortfolioContext,
  formatRewardToRisk,
  formatRiskAssessmentExtensions,
  formatRiskMandate,
  formatScenarioForecastExtensions,
  formatStanceContributions,
  formatStandingThesis,
  formatThesisExtensions,
  formatTradeProposalExtensions,
  readContributionsEntries,
} from "./lib/format";

/**
 * Shared no-fabrication rule injected into every generator's prompt via the
 * `core` preset (FIX-605). Expressed once, applied uniformly across all
 * twelve agents in the pipeline.
 *
 * The Phase 1 analyst `SHARED_PREAMBLE` historically carried the only
 * anti-fabrication language ("from the data provided … not from prior
 * knowledge"); phases 2–5 had nothing forbidding the model from filling
 * gaps with its own training knowledge. On a well-known ticker this was
 * masked because training knowledge happened to agree with the data; on
 * a bogus ticker the model would invent a plausible company and proceed
 * confidently. This clause closes that gap.
 */
/**
 * Codifies the citation contract for the `investigate` preset (FIX-612).
 * Paired with the `fetch` tool. Both ride along only on `costPreset ===
 * "full"`; the cheap path stays free of web fetches and this clause is
 * suppressed from the prompt entirely (the context resolver returns
 * `null`, which `core/capability` drops, so the `<investigation>` tag
 * isn't emitted at all rather than as an empty pair).
 */
const INVESTIGATION_CLAUSE = [
  "<investigation>",
  "Your <data> block may include a discovery payload listing numbered URLs.",
  "You may read them via the `fetch` tool when the deterministic data does",
  "not capture material context (recent management change, regulatory",
  "action, business-mix shift, competitor move). Read at most 2-3 URLs per",
  "memo — pick the most material.",
  "",
  "Every claim in your memo body must trace to either a <data> field or a",
  "URL you fetched. When you cite a fetched URL in your body, add it to",
  "the `citations` array with its title. Do not cite URLs you did not",
  "actually fetch. If your <data> already answers the question, do not",
  "fetch — emit `citations: null` and synthesise from <data> only.",
  "</investigation>",
].join("\n");

/** Shared `fetch` tool instance used by the `investigate` and `verify`
 *  presets. One instance reused across all generators that opt in — the tool
 *  is stateless and the framework binds per-call itemVisibility / agentName
 *  from the generator that consumed it. */
const fetchArticle = createFetchTool();

/** Shared `search` tool instance for the `verify` preset (Phase 6). Auto-
 *  detects the best available web-search provider from env. */
const searchWeb = createSearchTool();

/**
 * Codifies the verification contract for the Phase 6 `verify` preset. Paired
 * with the `search` + `fetch` tools. The thesis validator's job is to test
 * claims against reality, so — unlike `investigate` — this is NOT cost-gated:
 * verification is the agent's entire purpose and there is exactly one such
 * agent per run (only when a user thesis was provided, an explicit opt-in).
 *
 * The clause also tells the validator to recognize when its own research came
 * up short and to treat that as a blind spot rather than asserting an
 * unverified verdict.
 */
const VERIFICATION_CLAUSE = [
  "<verification>",
  "You have `search` and `fetch` tools. Use them to independently verify the",
  "user's thesis and the pipeline's findings — do not rely on your own",
  "training knowledge alone.",
  "",
  "- When the user's thesis or a memo names a specific, checkable claim (a",
  "  deal, acquisition, partnership, number, event, or date), search for it",
  "  before judging it supported or contradicted. If an analyst memo reports",
  "  it found no coverage of a claim, search yourself before concluding the",
  "  claim is false — absence in one analyst's feed is not disproof.",
  "- Fetch the most material 1-3 URLs when a search snippet is not enough.",
  "  Add every URL you actually fetched to the `citations` array with its",
  "  title. Do not cite URLs you did not fetch.",
  "- If your searches are inconclusive — no authoritative source, conflicting",
  "  reports, or you have run out of useful queries — say so explicitly in the",
  "  body and record it as a blind spot. An honest \"could not confirm X\" is",
  "  worth more than a confident guess. Do not upgrade `alignmentConfidence`",
  "  for a claim you could not verify.",
  "</verification>",
].join("\n");

const GROUNDING_CLAUSE = [
  "<grounding>",
  "Operate strictly on data provided by upstream agents, tools, and the",
  "context blocks below. Do not substitute your own training knowledge",
  "about the company, ticker, sector, or market for missing or empty",
  "inputs. If upstream data is materially incomplete or empty (analyst",
  "memos missing, transcripts empty, tool payloads marked `unavailable`",
  "or all-zero), say so explicitly — surface \"insufficient data to",
  "assess X\" rather than fabricating to fill the shape. Quoted figures,",
  "named entities, dates, and events must trace to an upstream artifact.",
  "</grounding>",
].join("\n");

async function memoState(ctx: { resources: any }, collectionKey: string): Promise<unknown> {
  const ref = await ctx.resources.memos?.getOptional(collectionKey);
  return ref?.state;
}

export const tradingDesk = defineCapability({
  name: "tradingDesk",
  sessionStateSchema,
  presets: {
    default: ["core"],

    /** Required always-on slice: model selection + ticker/date context +
     *  shared grounding clause. The grounding clause is injected once here
     *  so every generator in every phase is bound to upstream-provided data
     *  only — no per-prompt drift, no phases 2–5 silently substituting the
     *  model's training knowledge for missing or empty inputs (FIX-605). */
    core: {
      resources: { specialInstructions: specialInstructionsResource },
      model: (_input, ctx) => `intent/${ctx.session.state.costPreset}`,
      context: [
        {
          ticker: (_input, ctx) => ctx.session.state.ticker,
          date: (_input, ctx) => ctx.session.state.date,
          userInstructions: (_input, ctx) =>
            formatUserInstructions(
              ctx.resources.specialInstructions?.state,
              ctx.session.state.activePhase,
            ),
        },
        GROUNDING_CLAUSE,
      ],
    },

    /** Opt-in model swap to the `-reasoning` intent variant — generators
     *  that list `tradingDesk.presets({ reasoning: true })` resolve to
     *  `intent/fast-reasoning` / `intent/full-reasoning` instead of the
     *  plain `intent/fast` / `intent/full` the `core` preset picks. The
     *  `server.ts` resolver maps both variants today. Defined immediately
     *  after `core` so the capability-merge "last-wins" rule on `model:`
     *  lets this preset override `core` when active. */
    reasoning: {
      model: (_input, ctx) => `intent/${ctx.session.state.costPreset}-reasoning`,
    },
    highReasoning: {
      model: (_input, ctx) => `intent/${ctx.session.state.costPreset}-high-reasoning`,
    },

    /** Phase 1 — all four analyst memos (fundamentals, sentiment, news, technical). */
    phase1Memos: {
      resources: { memos: memosCollection },
      context: {
        phase1Memos: (_input, ctx) => formatAnalystMemos(ctx.resources.memos),
      },
    },

    /** Phase 2 — bull-side debate contributions, filtered from the round-robin
     *  transcript. Resource state is keyed by accessor name; the phase-2
     *  round-robin is configured with `accessorKey: "p2Contributions"` so
     *  reads and writes line up. */
    bullContributions: {
      resources: { p2Contributions: phase2Contributions },
      context: {
        bullContributions: (_input, ctx) =>
          formatStanceContributions(
            readContributionsEntries(ctx, "p2Contributions"),
            PHASE_2_MEMO_KEYS.bull.agentName,
          ),
      },
    },

    /** Phase 2 — bear-side debate contributions. */
    bearContributions: {
      resources: { p2Contributions: phase2Contributions },
      context: {
        bearContributions: (_input, ctx) =>
          formatStanceContributions(
            readContributionsEntries(ctx, "p2Contributions"),
            PHASE_2_MEMO_KEYS.bear.agentName,
          ),
      },
    },

    /** Phase 2 — consolidated bull memo (full BullThesis). */
    bullThesis: {
      resources: { memos: memosCollection },
      context: {
        bullThesis: async (_input, ctx) =>
          formatMemoBlock("Bull thesis", await memoState(ctx, PHASE_2_MEMO_KEYS.bull.collectionKey)),
      },
    },

    /** Phase 2 — consolidated bear memo. */
    bearThesis: {
      resources: { memos: memosCollection },
      context: {
        bearThesis: async (_input, ctx) =>
          formatMemoBlock("Bear thesis", await memoState(ctx, PHASE_2_MEMO_KEYS.bear.collectionKey)),
      },
    },

    /** Phase 2 — research-manager InvestmentThesis (memo body + typed extension fields). */
    investmentThesis: {
      resources: { memos: memosCollection },
      context: {
        investmentThesis: async (_input, ctx) =>
          formatMemoBlock(
            "Investment thesis",
            await memoState(ctx, PHASE_2_MEMO_KEYS.researchManager.collectionKey),
          ),
        investmentThesisFields: async (_input, ctx) =>
          formatThesisExtensions(
            await memoState(ctx, PHASE_2_MEMO_KEYS.researchManager.collectionKey),
          ),
      },
    },

    /** Phase 3 — trade-proposal memo + typed extension fields. */
    tradeProposal: {
      resources: { memos: memosCollection },
      context: {
        tradeProposal: async (_input, ctx) =>
          formatMemoBlock("Trade proposal", await memoState(ctx, PHASE_3_MEMO_KEYS.trader.collectionKey)),
        tradeProposalFields: async (_input, ctx) =>
          formatTradeProposalExtensions(await memoState(ctx, PHASE_3_MEMO_KEYS.trader.collectionKey)),
      },
    },

    /** Phase 4 — consolidated risk-assessment memo (body + typed extension
     *  fields). The `riskCritiques` preset bundles only the three persona
     *  memos; the PM generator reads both the personas and the
     *  consolidator output, so this preset is the cleanest path to the
     *  latter. */
    riskAssessment: {
      resources: { memos: memosCollection },
      context: {
        riskAssessment: async (_input, ctx) =>
          formatMemoBlock(
            "Risk assessment",
            await memoState(ctx, PHASE_4_MEMO_KEYS.riskAssessment.collectionKey),
          ),
        riskAssessmentFields: async (_input, ctx) =>
          formatRiskAssessmentExtensions(
            await memoState(ctx, PHASE_4_MEMO_KEYS.riskAssessment.collectionKey),
          ),
      },
    },

    /** Phase 4 — three persona critiques (aggressive, conservative, neutral). */
    riskCritiques: {
      resources: { memos: memosCollection },
      context: {
        aggressiveCritique: async (_input, ctx) =>
          formatPersonaCritique(
            "Aggressive Risk critique",
            await memoState(ctx, PHASE_4_MEMO_KEYS.aggressive.collectionKey),
          ),
        conservativeCritique: async (_input, ctx) =>
          formatPersonaCritique(
            "Conservative Risk critique",
            await memoState(ctx, PHASE_4_MEMO_KEYS.conservative.collectionKey),
          ),
        neutralCritique: async (_input, ctx) =>
          formatPersonaCritique(
            "Neutral Risk critique",
            await memoState(ctx, PHASE_4_MEMO_KEYS.neutral.collectionKey),
          ),
      },
    },

    /** Phase 5 — portfolio-manager decision memo, for Phase 6 consumption.
     *  The thesis validator reads the PM's published decision as the
     *  terminal output of the independent pipeline. Distinct from
     *  `tradeProposal` (Phase 3) — this is the final arbiter's call. */
    portfolioDecision: {
      resources: { memos: memosCollection },
      context: {
        portfolioDecision: async (_input, ctx) =>
          formatMemoBlock(
            "Portfolio decision",
            await memoState(ctx, PHASE_5_MEMO_KEYS.portfolioManager.collectionKey),
          ),
      },
    },

    /** Phase 5 — scenario-forecast memo + typed extension fields. The PM
     *  consumes the distribution as structured input so it can reference
     *  specific buckets when justifying confidence. */
    scenarioForecast: {
      resources: { memos: memosCollection },
      context: {
        scenarioForecast: async (_input, ctx) =>
          formatMemoBlock(
            "Scenario forecast",
            await memoState(ctx, PHASE_5_MEMO_KEYS.scenarioForecast.collectionKey),
          ),
        scenarioForecastFields: async (_input, ctx) =>
          formatScenarioForecastExtensions(
            await memoState(ctx, PHASE_5_MEMO_KEYS.scenarioForecast.collectionKey),
          ),
      },
    },

    /** Per-run user thesis context — only the Phase 6 validator opts in.
     *  CRITICAL: the `core` preset does NOT use this. The pipeline (P1–P5)
     *  must run blind to the user's thesis so its analysis stays independent;
     *  the validator audits the user against that independent evidence.
     *  Uses `<userThesis>` / `<userThesisRationale>` tags — deliberately
     *  distinct from `core`'s `<userInstructions>` tag, never the same tag
     *  for both. Returns `null` (not `""`) when a field is empty so the XML
     *  renderer omits the tag entirely. */
    userThesis: {
      context: {
        userThesis: (_input, ctx) =>
          ctx.session.state.userThesis
            ? `<userThesis>\n${ctx.session.state.userThesis}\n</userThesis>`
            : null,
        userThesisRationale: (_input, ctx) =>
          ctx.session.state.userThesisRationale
            ? `<userThesisRationale>\n${ctx.session.state.userThesisRationale}\n</userThesisRationale>`
            : null,
      },
    },

    /** Phase 6 — web search + fetch for the thesis validator, plus the
     *  verification contract clause. Not cost-gated (see `VERIFICATION_CLAUSE`):
     *  the validator's job is to verify claims, and it only runs on an
     *  explicit user-thesis opt-in. */
    verify: {
      tools: () => [searchWeb, fetchArticle],
      context: {
        verification: () => VERIFICATION_CLAUSE,
      },
    },

    /** Phase 2 — citation-integrity report (FIX-679), read from session
     *  state where `validateCitations` wrote it (not from a memo). Injected
     *  into the Research Manager prompt so it can discount unverified
     *  citations during synthesis. Renders `""` (tag suppressed) when no
     *  tagged contributions were checked. */
    citationIntegrity: {
      context: {
        citationIntegrity: (_input, ctx) =>
          formatCitationIntegrity(ctx.session.state.citationIntegrity),
      },
    },

    /** Phase 2 — full bull/bear debate transcript. */
    phase2Debate: {
      resources: { p2Contributions: phase2Contributions },
      context: {
        phase2Debate: (_input, ctx) =>
          formatDebate(readContributionsEntries(ctx, "p2Contributions")),
      },
    },

    /**
     * Opt-in investigative slice for Phase 1 analysts (FIX-612). Exposes
     * the `fetch` tool and the `INVESTIGATION_CLAUSE` (which codifies the
     * citation contract). Both are hard-gated on `costPreset === "full"`
     * so cheap runs perform no extra web fetches and the prompt stays
     * lean. Returning `null` from the context function (rather than `""`)
     * suppresses the `<investigation>` tag entirely on `fast` runs.
     *
     * Per-analyst discovery tools (`discover_*_context`) self-gate at
     * the tool-body level. This preset and those tool short-circuits are
     * the two coordinated cost-preset seams; neither alone is sufficient.
     */
    investigate: {
      tools: (ctx) =>
        ctx.session.state.costPreset === "full" ? [fetchArticle] : [],
      context: {
        investigation: (_input, ctx) =>
          ctx.session.state.costPreset === "full" ? INVESTIGATION_CLAUSE : null,
      },
    },

    /**
     * Phase 2 — closed-world counter-evidence tool for Bull/Bear (FIX-679).
     * Exposes `find_counter_evidence` only on `costPreset === "full"` so the
     * cheap path runs no extra search. The hard cap of 1 call per debater
     * per round is enforced by `ROUND_ROBIN_INSTRUCTIONS`, not tool-level
     * state — the prompt is the cheapest place to bound a closed-world,
     * side-effect-free lookup. Resources are declared statically so the
     * tool's `ctx.resources.memos` / `p2Contributions` resolve at runtime.
     */
    counterEvidence: {
      resources: { memos: memosCollection, p2Contributions: phase2Contributions },
      tools: (ctx) =>
        ctx.session.state.costPreset === "full" ? [find_counter_evidence] : [],
    },

    /** Valuation spine — computed deterministic anchor for the final
     *  rating. Injects `<valuationSpine>` (expected return, fair value,
     *  setup score) and `<ratingEnvelope>` (implied rating + permitted
     *  band) from the session-scoped spine resource. Returns null (tag
     *  suppressed) when the resource hasn't been populated yet. Opted
     *  into by: trader, risk consolidator, scenario forecaster, PM,
     *  and research manager. Bull/bear stay blind. */
    valuationSpine: {
      resources: { valuationSpine: valuationSpineResource },
      context: {
        valuationSpine: (_input, ctx) => {
          const spine = ctx.resources.valuationSpine?.state;
          if (!spine) return null;
          return formatValuationSpine(spine);
        },
        ratingEnvelope: (_input, ctx) => {
          const spine = ctx.resources.valuationSpine?.state;
          if (!spine) return null;
          return formatRatingEnvelope(spine.envelope);
        },
      },
    },

    /** Live-portfolio context for the trader (P3) and PM (P5). Reads the frozen
     *  session-state snapshot (no resource — it was frozen at seed time, same
     *  pattern as `userThesis`). Returns null to suppress the `<portfolioContext>`
     *  tag entirely when no portfolio was supplied — the run stays
     *  portfolio-blind exactly as today. */
    portfolioContext: {
      context: {
        portfolioContext: (_input, ctx) =>
          formatPortfolioContext(
            ctx.session.state.portfolio,
            ctx.session.state.selectedAccountIds,
            ctx.session.state.ticker,
          ),
      },
    },

    /** Deterministic lens-convergence read for the PM (P5). The PM consumes it
     *  as the conviction input that sizes `portfolioFit` (convergence ->
     *  conviction -> size). Returns null (tag suppressed) when the lens pack did
     *  not run (fast preset) or has not computed yet. */
    lensConvergence: {
      resources: { lensConvergence: lensConvergenceResource },
      context: {
        lensConvergence: (_input, ctx) =>
          formatLensConvergence(ctx.resources.lensConvergence?.state),
      },
    },

    /** Scenario-derived reward-to-risk figure (FIX-752) — the PM reads it as the
     *  worth-it input it judges against the mandate. From the session-scoped
     *  resource the post-forecast tap writes. Returns null (tag suppressed) when
     *  the forecaster produced no usable buckets. PM only. */
    rewardToRisk: {
      resources: { rewardToRisk: rewardToRiskResource },
      context: {
        rewardToRisk: (_input, ctx) =>
          formatRewardToRisk(ctx.resources.rewardToRisk?.state),
      },
    },

    /** Active risk-appetite mandate (FIX-752) — the variable standard the PM
     *  sizes against. Reads the frozen session-state mandate (no resource — the
     *  `userThesis` pattern). Returns null to suppress the `<riskMandate>` tag on
     *  a mandate-blind run. Opted into by the trader (sizes with awareness) and
     *  the PM (the worth-it arbiter). */
    riskMandate: {
      context: {
        riskMandate: (_input, ctx) =>
          formatRiskMandate(ctx.session.state.riskMandate),
      },
    },

    /** Standing per-position thesis (FIX-760) — the user's durable "why" for a
     *  held name. Reads the frozen session-state thesis (no resource — the
     *  `portfolioContext` / `riskMandate` pattern). Returns null to suppress the
     *  `<standingThesis>` tag on a thesis-blind run. Opted into by the trader (P3)
     *  and the PM (P5) ONLY — the analysts stay blind so the independent evidence
     *  is uncontaminated. Distinct from the `userThesis` preset (the Phase 6
     *  hypothesis-under-audit) — never the same tag for both. */
    standingThesis: {
      context: {
        standingThesis: (_input, ctx) =>
          formatStandingThesis(ctx.session.state.standingThesis),
      },
    },

    // ────────────────────────────────────────────────────────────────────
    // Cost-preset-gated variants.
    //
    // Every generator declares these statically (no dynamic `uses` lambda).
    // The context formatters render an empty string when `costPreset !==
    // "full"`, so the heavier prompt blocks only ride along on the full
    // preset. Resources are still declared up-front, so static resource
    // merging always succeeds.
    //
    // Why these exist as separate presets rather than always-on flags on
    // the base presets: the Phase 2 consolidators and research manager
    // use `phase1Memos` / `phase2Debate` as ALWAYS-ON context, while
    // Phase 3, 4, and 5 want them as FULL-ONLY context. Same content,
    // two different gating policies — so two presets.
    // ────────────────────────────────────────────────────────────────────

    /** Phase 1 analyst memos, rendered only on the `full` cost preset.
     *  Always-on equivalent is `phase1Memos`. */
    phase1MemosFull: {
      resources: { memos: memosCollection },
      context: {
        phase1Memos: (_input, ctx) =>
          ctx.session.state.costPreset === "full"
            ? formatAnalystMemos(ctx.resources.memos)
            : "",
      },
    },

    /** Phase 2 bull/bear debate transcript, rendered only on `full`.
     *  Always-on equivalent is `phase2Debate`. */
    phase2DebateFull: {
      resources: { p2Contributions: phase2Contributions },
      context: {
        phase2Debate: (_input, ctx) =>
          ctx.session.state.costPreset === "full"
            ? formatDebate(readContributionsEntries(ctx, "p2Contributions"))
            : "",
      },
    },

    /** Three persona critiques, rendered only on `full`. Always-on
     *  equivalent is `riskCritiques` — used by the Phase 4 consolidator
     *  which needs the persona memos regardless of preset. The Phase 5
     *  PM reads the consolidated risk assessment always, and the persona
     *  memos only on full as extra audit context — hence this variant. */
    riskCritiquesFull: {
      resources: { memos: memosCollection },
      context: {
        aggressiveCritique: async (_input, ctx) =>
          ctx.session.state.costPreset === "full"
            ? formatPersonaCritique(
                "Aggressive Risk critique",
                await memoState(ctx, PHASE_4_MEMO_KEYS.aggressive.collectionKey),
              )
            : "",
        conservativeCritique: async (_input, ctx) =>
          ctx.session.state.costPreset === "full"
            ? formatPersonaCritique(
                "Conservative Risk critique",
                await memoState(ctx, PHASE_4_MEMO_KEYS.conservative.collectionKey),
              )
            : "",
        neutralCritique: async (_input, ctx) =>
          ctx.session.state.costPreset === "full"
            ? formatPersonaCritique(
                "Neutral Risk critique",
                await memoState(ctx, PHASE_4_MEMO_KEYS.neutral.collectionKey),
              )
            : "",
      },
    },
  },
});

/** Re-exports so call sites don't need to import the helpers separately
 *  when they're using the capability. */
export {
  formatAnalystMemos,
  formatCitationIntegrity,
  formatDebate,
  formatLensConvergence,
  formatMemoBlock,
  formatPersonaCritique,
  formatPortfolioContext,
  formatRewardToRisk,
  formatRiskAssessmentExtensions,
  formatRiskMandate,
  formatScenarioForecastExtensions,
  formatStanceContributions,
  formatStandingThesis,
  formatThesisExtensions,
  formatTradeProposalExtensions,
  readContributionsEntries,
} from "./lib/format";
