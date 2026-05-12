/**
 * The Phase 3 trader generator.
 *
 * Single-shot structured-synthesis: reads the Phase 2 InvestmentThesis
 * (plus, on `full` preset, the four analyst memos and the bull/bear
 * transcript) and writes a typed `TradeProposal`.
 *
 * `agentType: "primary"` so the structured `TxStruct` card renders in the
 * transcript automatically — `"trader"` is already in `PRIMARY_STRUCT_AGENTS`.
 *
 * Prompt depth scales with `costPreset`:
 *   - "fast": RM memo block + extension fields only.
 *   - "full": adds Phase 1 analyst memos + full bull/bear debate transcript.
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
} from "../agents";
import { memosCollection } from "../resources";
import { sessionStateSchema } from "../state";
import { phase2Contributions } from "../phase-2/round-robin";
import { tradeProposalOutputSchema } from "./schemas";
import { TRADER_PROMPT } from "./prompts";

const generatorResources = {
  memos: memosCollection,
  contributions: phase2Contributions,
} as const;

function modelFor(costPreset: "fast" | "full" | undefined): string {
  return costPreset === "full" ? "intent/chat" : "intent/utility";
}

function readContributions(ctx: any): RoundRobinContributionEntry[] {
  const state = ctx.resources?.contributions?.state as
    | RoundRobinContributionsState
    | undefined;
  return state?.entries ?? [];
}

/**
 * Render a memo state as a compact prompt block. Trustworthy enough for
 * prompt rendering — `memoStateSchema` enforces shape at write time.
 */
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
    for (const section of memo.body as Array<{ h: string; p?: string; items?: string[] }>) {
      const head = `### ${section.h}`;
      const body = section.p ?? "";
      const items = (section.items ?? []).map((i: string) => `- ${i}`).join("\n");
      lines.push([head, body, items].filter((s) => s.length > 0).join("\n"));
    }
  }
  return lines.join("\n");
}

/** Render the RM memo's five Phase 2 extension fields as a prompt block.
 *  This is what lets the trader reason about the debate's outcome on the
 *  `fast` preset without re-reading the transcript. */
function formatExtensionFields(memo: any): string {
  if (memo === undefined || memo === null) {
    return "(no extension fields available)";
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
  return lines.length > 0 ? lines.join("\n") : "(extension fields empty)";
}

/** Render the four Phase 1 analyst memos for inclusion in the user prompt. */
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

/** Render the full debate transcript (both sides), grouped by round. */
function formatFullDebate(entries: RoundRobinContributionEntry[]): string {
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
      const role = AGENTS[entry.agentName as keyof typeof AGENTS]?.role ?? entry.agentName;
      lines.push(`**${role}:** ${entry.text}`);
    }
  }
  return lines.join("\n");
}

export const traderGenerator = generator({
  name: "trader-generator",
  agentType: "primary",
  agentName: PHASE_3_MEMO_KEYS.trader.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: TRADER_PROMPT,
  user: (_input, ctx) => {
    const ticker = ctx.session.state.ticker as string;
    const date = ctx.session.state.date as string;
    const preset =
      (ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast";
    const rmRef = ctx.resources.memos.getOptional(
      PHASE_2_MEMO_KEYS.researchManager.collectionKey,
    );
    const lines: string[] = [
      `Ticker: ${ticker}`,
      `As-of date: ${date}`,
      "",
      "## Phase 2 — Investment Thesis (research manager)",
      formatMemoBlock("Investment thesis", rmRef?.state),
      "",
      "### Debate outcome (extension fields)",
      formatExtensionFields(rmRef?.state),
    ];
    if (preset === "full") {
      lines.push(
        "",
        "## Phase 1 — Analyst memos (full preset only)",
        formatAnalystMemos(ctx.resources.memos as any),
        "",
        "## Phase 2 — Full debate transcript (full preset only)",
        formatFullDebate(readContributions(ctx)),
      );
    }
    lines.push("", "Now write the published TradeProposal.");
    return lines.join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: tradeProposalOutputSchema,
});
