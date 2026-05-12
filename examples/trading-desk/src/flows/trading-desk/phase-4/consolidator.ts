/**
 * The Phase 4 `riskAssessmentGenerator` — single-shot consolidation step.
 *
 * Reads the three Phase 4 persona memos (aggressive, conservative, neutral)
 * with their structured fields, the Phase 3 trade proposal, the Phase 2
 * investment thesis, and the round-robin transcript. On the `full` cost
 * preset, also reads the four Phase 1 analyst memos and the Phase 2
 * bull/bear debate transcript.
 *
 * Emits a typed `RiskAssessment` — what Phase 5 (the portfolio manager)
 * actually consumes. The three persona memos remain as the audit trail.
 *
 * `agentType: "sub"` — no structured-output card in the transcript; the
 * memo on the right pane is the artifact. See §10 OQ4.
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
import { phase4Contributions } from "./round-robin";
import { RISK_ASSESSMENT_PROMPT } from "./prompts";
import { riskAssessmentOutputSchema } from "./schemas";

const generatorResources = {
  memos: memosCollection,
  p2Contributions: phase2Contributions,
  p4Contributions: phase4Contributions,
} as const;

function modelFor(costPreset: "fast" | "full" | undefined): string {
  return costPreset === "full" ? "intent/chat" : "intent/utility";
}

function readContributions(
  ctx: any,
  resourceName: "p2Contributions" | "p4Contributions",
): RoundRobinContributionEntry[] {
  const state = ctx.resources?.[resourceName]?.state as
    | RoundRobinContributionsState
    | undefined;
  return state?.entries ?? [];
}

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

function formatPersonaCritique(label: string, memo: any): string {
  if (memo === undefined || memo === null || memo.headline == null) {
    return `## ${label}\n(no critique available)`;
  }
  const lines = [formatMemoBlock(label, memo)];
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
  return lines.length > 0 ? lines.join("\n") : "(trade fields empty)";
}

function formatThesisExtensions(memo: any): string {
  if (memo === undefined || memo === null) {
    return "(no investment thesis available)";
  }
  const lines: string[] = [];
  if (memo.stance != null) lines.push(`Stance: ${memo.stance}`);
  if (memo.conviction != null) lines.push(`Conviction: ${memo.conviction}`);
  if (
    Array.isArray(memo.unresolvedDisagreements) &&
    memo.unresolvedDisagreements.length > 0
  ) {
    lines.push("Unresolved disagreements:");
    for (const d of memo.unresolvedDisagreements) lines.push(`- ${d}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(thesis fields empty)";
}

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

function formatDebate(entries: RoundRobinContributionEntry[]): string {
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

export const riskAssessmentGenerator = generator({
  name: "risk-assessment-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.riskAssessment.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: RISK_ASSESSMENT_PROMPT,
  user: (_input, ctx) => {
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
    const aggressiveRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.aggressive.collectionKey,
    );
    const conservativeRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.conservative.collectionKey,
    );
    const neutralRef = ctx.resources.memos.getOptional(
      PHASE_4_MEMO_KEYS.neutral.collectionKey,
    );
    const lines: string[] = [
      `Ticker: ${ticker}`,
      `As-of date: ${date}`,
      "",
      "## Phase 3 — Trade proposal",
      formatMemoBlock("Trade proposal", tradeRef?.state),
      "",
      "### Trade fields (typed)",
      formatTradeProposalExtensions(tradeRef?.state),
      "",
      "## Phase 2 — Investment thesis",
      formatMemoBlock("Investment thesis", thesisRef?.state),
      "",
      "### Debate outcome (extension fields)",
      formatThesisExtensions(thesisRef?.state),
      "",
      "## Phase 4 — Aggressive Risk critique",
      formatPersonaCritique("Aggressive Risk", aggressiveRef?.state),
      "",
      "## Phase 4 — Conservative Risk critique",
      formatPersonaCritique("Conservative Risk", conservativeRef?.state),
      "",
      "## Phase 4 — Neutral Risk critique",
      formatPersonaCritique("Neutral Risk", neutralRef?.state),
      "",
      "## Phase 4 — Round-robin transcript (free-form contributions)",
      formatDebate(readContributions(ctx, "p4Contributions")),
    ];
    if (preset === "full") {
      lines.push(
        "",
        "## Phase 1 — Analyst memos (full preset only)",
        formatAnalystMemos(ctx.resources.memos as any),
        "",
        "## Phase 2 — Full bull/bear debate transcript (full preset only)",
        formatDebate(readContributions(ctx, "p2Contributions")),
      );
    }
    lines.push("", "Now write the published RiskAssessment.");
    return lines.join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: riskAssessmentOutputSchema,
});
