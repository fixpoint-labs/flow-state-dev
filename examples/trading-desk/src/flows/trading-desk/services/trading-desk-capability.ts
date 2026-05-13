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
 *      `<ticker>` and `<date>` tags from session state into every
 *      generator's prompt. No per-generator boilerplate.
 *
 *   3. **Opt-in context bundles** — named presets that inject specific
 *      memo, contribution, or debate-transcript context tags. Generators
 *      opt in via `tradingDesk.presets({ phase1Memos: true, ... })`.
 *      Each bundle also declares the resources it reads, so consumers
 *      don't have to mirror that in their own `resources:` slot.
 */
import { defineCapability } from "@flow-state-dev/core";
import {
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
} from "../agents";
import { memosCollection } from "../resources";
import { phase2Contributions } from "../phase-2/contributions";
import { phase4Contributions } from "../phase-4/contributions";
import { sessionStateSchema, type SessionState } from "../state";
import {
  formatAnalystMemos,
  formatDebate,
  formatMemoBlock,
  formatPersonaCritique,
  formatStanceContributions,
  formatThesisExtensions,
  formatTradeProposalExtensions,
  readContributionsEntries,
} from "./format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CtxAny = { session: { state: SessionState }; resources: any };

function memoState(ctx: CtxAny, collectionKey: string): unknown {
  return ctx.resources.memos?.getOptional(collectionKey)?.state;
}

export const tradingDesk = defineCapability({
  name: "tradingDesk",
  sessionStateSchema,
  presets: {
    default: ["core"],

    /** Required always-on slice: model selection + ticker/date context. */
    core: {
      model: (_input, ctx) => `intent/${ctx.session.state.costPreset}`,        
      context: {
        ticker: (_input, ctx) => ctx.session.state.ticker,
        date: (_input, ctx) => ctx.session.state.date,
      },
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
        bullThesis: (_input, ctx) =>
          formatMemoBlock("Bull thesis", memoState(ctx, PHASE_2_MEMO_KEYS.bull.collectionKey)),
      },
    },

    /** Phase 2 — consolidated bear memo. */
    bearThesis: {
      resources: { memos: memosCollection },
      context: {
        bearThesis: (_input, ctx) =>
          formatMemoBlock("Bear thesis", memoState(ctx, PHASE_2_MEMO_KEYS.bear.collectionKey)),
      },
    },

    /** Phase 2 — research-manager InvestmentThesis (memo body + typed extension fields). */
    investmentThesis: {
      resources: { memos: memosCollection },
      context: {
        investmentThesis: (_input, ctx) =>
          formatMemoBlock(
            "Investment thesis",
            memoState(ctx, PHASE_2_MEMO_KEYS.researchManager.collectionKey),
          ),
        investmentThesisFields: (_input, ctx) =>
          formatThesisExtensions(
            memoState(ctx, PHASE_2_MEMO_KEYS.researchManager.collectionKey),
          ),
      },
    },

    /** Phase 3 — trade-proposal memo + typed extension fields. */
    tradeProposal: {
      resources: { memos: memosCollection },
      context: {
        tradeProposal: (_input, ctx) =>
          formatMemoBlock("Trade proposal", memoState(ctx, PHASE_3_MEMO_KEYS.trader.collectionKey)),
        tradeProposalFields: (_input, ctx) =>
          formatTradeProposalExtensions(memoState(ctx, PHASE_3_MEMO_KEYS.trader.collectionKey)),
      },
    },

    /** Phase 4 — three persona critiques (aggressive, conservative, neutral). */
    riskCritiques: {
      resources: { memos: memosCollection },
      context: {
        aggressiveCritique: (_input, ctx) =>
          formatPersonaCritique(
            "Aggressive Risk critique",
            memoState(ctx, PHASE_4_MEMO_KEYS.aggressive.collectionKey),
          ),
        conservativeCritique: (_input, ctx) =>
          formatPersonaCritique(
            "Conservative Risk critique",
            memoState(ctx, PHASE_4_MEMO_KEYS.conservative.collectionKey),
          ),
        neutralCritique: (_input, ctx) =>
          formatPersonaCritique(
            "Neutral Risk critique",
            memoState(ctx, PHASE_4_MEMO_KEYS.neutral.collectionKey),
          ),
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

    /** Phase 4 — full risk-debate transcript. */
    phase4Debate: {
      resources: { p4Contributions: phase4Contributions },
      context: {
        phase4Debate: (_input, ctx) =>
          formatDebate(readContributionsEntries(ctx, "p4Contributions")),
      },
    },
  },
});

/** Re-exports so call sites don't need to import the helpers separately
 *  when they're using the capability. */
export {
  formatAnalystMemos,
  formatDebate,
  formatMemoBlock,
  formatPersonaCritique,
  formatStanceContributions,
  formatThesisExtensions,
  formatTradeProposalExtensions,
  readContributionsEntries,
} from "./format";
