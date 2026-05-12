/**
 * The three Phase 4 persona generators — aggressive, conservative, neutral.
 *
 * Each generator runs as a round-robin roster slot override (see
 * `phase-4/round-robin.ts`). Single-shot structured critique: reads the
 * Phase 3 trade proposal + Phase 2 investment thesis (always), prior
 * persona memos in fixed round-robin order (via `ctx.resources.memos.getOptional`),
 * and — on the `full` cost preset — the four Phase 1 analyst memos plus
 * the full bull/bear debate transcript (via `p2Contributions`).
 *
 * Personas read prior persona memos from `ctx.resources.memos`, not from
 * the round-robin's contributions resource, because the structured fields
 * (`raisedRisks`, `proposedAdjustments`, neutral's `dismissedRisks`) live
 * on the memo. The contributions resource only carries the `{ text }`
 * round-robin transcript and is lossy.
 *
 * `agentType: "sub"` — per the design, P4 personas emit speak rows only
 * (no structured-output card in the transcript). The memo on the right
 * pane is the persona's structured artifact.
 */
import { generator } from "@flow-state-dev/core";
import type {
  RoundRobinContributionEntry,
  RoundRobinContributionsState,
} from "@flow-state-dev/patterns/round-robin";
import {
  AGENTS,
  PHASE_1_MEMO_KEYS,
  PHASE_2_MEMO_KEYS,
  PHASE_3_MEMO_KEYS,
  PHASE_4_MEMO_KEYS,
} from "../agents";
import { memosCollection } from "../resources";
import { sessionStateSchema } from "../state";
import { phase2Contributions } from "../phase-2/round-robin";
import {
  AGGRESSIVE_PROMPT,
  CONSERVATIVE_PROMPT,
  NEUTRAL_PROMPT,
} from "./prompts";
import {
  neutralCritiqueOutputSchema,
  personaCritiqueOutputSchema,
} from "./schemas";

const generatorResources = {
  memos: memosCollection,
  p2Contributions: phase2Contributions,
} as const;

function modelFor(costPreset: "fast" | "full" | undefined): string {
  return costPreset === "full" ? "intent/chat" : "intent/utility";
}

function readP2Contributions(ctx: any): RoundRobinContributionEntry[] {
  const state = ctx.resources?.p2Contributions?.state as
    | RoundRobinContributionsState
    | undefined;
  return state?.entries ?? [];
}

/** Render a memo state as a compact prompt block. */
function formatMemoBlock(label: string, memo: any): string {
  if (memo === undefined || memo === null || memo.headline == null) {
    return `## ${label}\n(no memo available)`;
  }
  const lines = [
    `## ${label}`,
    `Rating: ${memo.rating ?? "—"}`,
    `Headline: ${memo.headline}`,
  ];
  if (memo.metrics != null) {
    const metricsLine = Object.entries(memo.metrics as Record<string, string>)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`Metrics: ${metricsLine}`);
  }
  if (Array.isArray(memo.body)) {
    for (const section of memo.body as Array<{
      h: string;
      p?: string | null;
      items?: string[] | null;
    }>) {
      const head = `### ${section.h}`;
      const body = section.p ?? "";
      const items = (section.items ?? [])
        .map((i: string) => `- ${i}`)
        .join("\n");
      lines.push([head, body, items].filter((s) => s.length > 0).join("\n"));
    }
  }
  return lines.join("\n");
}

/** Render the Phase 3 trade-proposal memo's typed extension fields. The
 *  persona reads these to ground its critique against the structured trade
 *  shape, not just the body prose. */
function formatTradeProposalExtensions(memo: any): string {
  if (memo === undefined || memo === null) {
    return "(no trade proposal available)";
  }
  const lines: string[] = [];
  if (memo.direction != null) lines.push(`Direction: ${memo.direction}`);
  if (memo.sizePct != null) lines.push(`Size (% NAV): ${memo.sizePct}`);
  if (memo.stopPrice != null) lines.push(`Stop: $${memo.stopPrice}`);
  if (memo.targetPrice != null) lines.push(`Target: $${memo.targetPrice}`);
  if (memo.holdingPeriod != null)
    lines.push(`Holding period: ${memo.holdingPeriod}`);
  if (
    Array.isArray(memo.invalidationCriteria) &&
    memo.invalidationCriteria.length > 0
  ) {
    lines.push("Invalidation criteria:");
    for (const c of memo.invalidationCriteria) lines.push(`- ${c}`);
  }
  if (Array.isArray(memo.dependsOn) && memo.dependsOn.length > 0) {
    lines.push("Depends on (unresolved):");
    for (const d of memo.dependsOn) lines.push(`- ${d}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(trade fields empty)";
}

/** Render the InvestmentThesis extension fields. */
function formatThesisExtensions(memo: any): string {
  if (memo === undefined || memo === null) {
    return "(no investment thesis available)";
  }
  const lines: string[] = [];
  if (memo.stance != null) lines.push(`Stance: ${memo.stance}`);
  if (memo.conviction != null) lines.push(`Conviction: ${memo.conviction}`);
  if (Array.isArray(memo.keyRisks) && memo.keyRisks.length > 0) {
    lines.push("Key risks:");
    for (const r of memo.keyRisks) lines.push(`- ${r}`);
  }
  if (Array.isArray(memo.keyOpportunities) && memo.keyOpportunities.length > 0) {
    lines.push("Key opportunities:");
    for (const o of memo.keyOpportunities) lines.push(`- ${o}`);
  }
  if (
    Array.isArray(memo.unresolvedDisagreements) &&
    memo.unresolvedDisagreements.length > 0
  ) {
    lines.push("Unresolved disagreements:");
    for (const d of memo.unresolvedDisagreements) lines.push(`- ${d}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(thesis fields empty)";
}

/** Render a Phase 4 persona memo's structured critique fields. Used by
 *  conservative (reads aggressive's memo) and neutral (reads both). */
function formatPersonaCritique(label: string, memo: any): string {
  if (memo === undefined || memo === null || memo.headline == null) {
    return `## ${label}\n(no critique available)`;
  }
  const lines = [`## ${label}`, formatMemoBlock(label, memo)];
  if (memo.posture != null) lines.push(`Posture: ${memo.posture}`);
  if (Array.isArray(memo.raisedRisks) && memo.raisedRisks.length > 0) {
    lines.push("Raised risks:");
    for (const r of memo.raisedRisks as Array<{
      description: string;
      severity: string;
    }>) {
      lines.push(`- [${r.severity}] ${r.description}`);
    }
  }
  if (memo.proposedAdjustments != null) {
    const pa = memo.proposedAdjustments as Record<string, string | null>;
    lines.push(
      `Proposed adjustments: sizing=${pa.sizing ?? "—"}, holdingPeriod=${
        pa.holdingPeriod ?? "—"
      }, invalidation=${pa.invalidation ?? "—"}`,
    );
  }
  if (Array.isArray(memo.dismissedRisks) && memo.dismissedRisks.length > 0) {
    lines.push("Dismissed risks (by this persona):");
    for (const d of memo.dismissedRisks as Array<{
      description: string;
      reason: string;
    }>) {
      lines.push(`- ${d.description} — ${d.reason}`);
    }
  }
  return lines.join("\n");
}

/** Render the four Phase 1 analyst memos as a compact block. */
function formatAnalystMemos(memos: {
  getOptional: (k: string) => { state: any } | undefined;
}): string {
  const blocks: string[] = [];
  for (const [, mapping] of Object.entries(PHASE_1_MEMO_KEYS)) {
    const ref = memos.getOptional(mapping.collectionKey);
    const role = AGENTS[mapping.agentName].role;
    blocks.push(formatMemoBlock(`${role}`, ref?.state));
  }
  return blocks.join("\n\n");
}

/** Render the full Phase 2 bull/bear debate transcript grouped by round. */
function formatP2Debate(entries: RoundRobinContributionEntry[]): string {
  if (entries.length === 0) return "(empty)";
  const byRound = new Map<number, RoundRobinContributionEntry[]>();
  for (const entry of entries) {
    const arr = byRound.get(entry.round) ?? [];
    arr.push(entry);
    byRound.set(entry.round, arr);
  }
  const lines: string[] = [];
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    lines.push(`### Round ${round}`);
    for (const entry of byRound.get(round)!) {
      const role =
        AGENTS[entry.agentName as keyof typeof AGENTS]?.role ?? entry.agentName;
      lines.push(`**${role}:** ${entry.text}`);
    }
  }
  return lines.join("\n");
}

/** Build the shared user-prompt prologue: ticker, date, trade proposal,
 *  investment thesis, and (on `full` preset) analyst memos + P2 debate. */
function buildSharedContext(ctx: any): string[] {
  const ticker = ctx.session.state.ticker as string;
  const date = ctx.session.state.date as string;
  const preset =
    (ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast";
  const tradeRef = ctx.resources.memos.getOptional(
    PHASE_3_MEMO_KEYS.trader.collectionKey,
  );
  const thesisRef = ctx.resources.memos.getOptional(
    PHASE_2_MEMO_KEYS.researchManager.collectionKey,
  );
  const lines: string[] = [
    `Ticker: ${ticker}`,
    `As-of date: ${date}`,
    "",
    "## Phase 3 — Trade proposal (trader)",
    formatMemoBlock("Trade proposal", tradeRef?.state),
    "",
    "### Trade fields (typed)",
    formatTradeProposalExtensions(tradeRef?.state),
    "",
    "## Phase 2 — Investment thesis (research manager)",
    formatMemoBlock("Investment thesis", thesisRef?.state),
    "",
    "### Debate outcome (extension fields)",
    formatThesisExtensions(thesisRef?.state),
  ];
  if (preset === "full") {
    lines.push(
      "",
      "## Phase 1 — Analyst memos (full preset only)",
      formatAnalystMemos(ctx.resources.memos as any),
      "",
      "## Phase 2 — Full bull/bear debate transcript (full preset only)",
      formatP2Debate(readP2Contributions(ctx)),
    );
  }
  return lines;
}

export const aggressiveRiskGenerator = generator({
  name: "aggressive-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.aggressive.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: AGGRESSIVE_PROMPT,
  user: (_input, ctx) => {
    const lines = buildSharedContext(ctx);
    lines.push("", "You are the first persona to speak in the round-robin.");
    lines.push("", "Now write the published Aggressive Risk critique.");
    return lines.join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: personaCritiqueOutputSchema,
});

export const conservativeRiskGenerator = generator({
  name: "conservative-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.conservative.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: CONSERVATIVE_PROMPT,
  user: (_input, ctx) => {
    const lines = buildSharedContext(ctx);
    const aggressiveRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.aggressive.collectionKey,
    );
    lines.push(
      "",
      formatPersonaCritique("Aggressive Risk critique", aggressiveRef?.state),
      "",
      "Now write the published Conservative Risk critique.",
    );
    return lines.join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: personaCritiqueOutputSchema,
});

export const neutralRiskGenerator = generator({
  name: "neutral-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.neutral.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: NEUTRAL_PROMPT,
  user: (_input, ctx) => {
    const lines = buildSharedContext(ctx);
    const aggressiveRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.aggressive.collectionKey,
    );
    const conservativeRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.conservative.collectionKey,
    );
    lines.push(
      "",
      formatPersonaCritique("Aggressive Risk critique", aggressiveRef?.state),
      "",
      formatPersonaCritique("Conservative Risk critique", conservativeRef?.state),
      "",
      "Now write the published Neutral Risk critique. Remember: your job is",
      "to filter, not to win. Populate `dismissedRisks` with the load-bearing",
      "call on what does not warrant action.",
    );
    return lines.join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: neutralCritiqueOutputSchema,
});
