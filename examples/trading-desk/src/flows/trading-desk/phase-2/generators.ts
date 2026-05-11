/**
 * The three Phase 2 generators that run after the round-robin loop:
 *   - `consolidateBullMemo` — consolidates bull-side contributions plus
 *     analyst memos into a `BullThesis`.
 *   - `consolidateBearMemo` — symmetric for the bear side.
 *   - `researchManagerGenerator` — synthesizes both consolidated memos,
 *     all four analyst memos, and the full debate transcript into an
 *     `InvestmentThesis` with explicit unresolved disagreements.
 *
 * Contributions come from the shared `phase2Contributions` resource —
 * passed to every `roundRobin()` instance and registered on the flow —
 * so each generator just declares it on its own `resources:` slot and
 * reads entries via `ctx.resources.contributions.state.entries`.
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
} from "../agents";
import { memosCollection } from "../resources";
import { sessionStateSchema } from "../state";
import { phase2Contributions } from "./round-robin";
import {
  bearThesisOutputSchema,
  bullThesisOutputSchema,
  investmentThesisOutputSchema,
} from "./thesis-schemas";
import {
  BEAR_CONSOLIDATION_PROMPT,
  BULL_CONSOLIDATION_PROMPT,
  RESEARCH_MANAGER_PROMPT,
} from "./prompts";

const generatorResources = {
  memos: memosCollection,
  contributions: phase2Contributions,
} as const;

function readContributions(ctx: any): RoundRobinContributionEntry[] {
  const state = ctx.resources?.contributions?.state as
    | RoundRobinContributionsState
    | undefined;
  return state?.entries ?? [];
}

function modelFor(costPreset: "fast" | "full" | undefined): string {
  return costPreset === "full" ? "intent/chat" : "intent/utility";
}

/**
 * Render a memo state as a compact prompt block. Field types are
 * permissive (`any`) because resource refs are typed `Readonly<any>` once
 * read off the collection — body shape is enforced by `memoStateSchema`
 * at write time, so reads are trustworthy enough for prompt rendering.
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

/**
 * Render contributions filtered to one stance, grouped by round. Returns
 * an empty string if no entries match.
 */
function formatStanceContributions(
  entries: RoundRobinContributionEntry[],
  agentName: string,
): string {
  const filtered = entries.filter((e) => e.agentName === agentName);
  if (filtered.length === 0) return "(no contributions for this stance)";
  const byRound = new Map<number, RoundRobinContributionEntry[]>();
  for (const entry of filtered) {
    const arr = byRound.get(entry.round) ?? [];
    arr.push(entry);
    byRound.set(entry.round, arr);
  }
  const lines: string[] = [];
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    lines.push(`Round ${round}:`);
    for (const entry of byRound.get(round)!) {
      lines.push(`- ${entry.text}`);
    }
  }
  return lines.join("\n");
}

/** Render the full debate transcript (both sides). */
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

export const consolidateBullMemo = generator({
  name: "consolidate-bull-memo",
  agentType: "sub",
  agentName: PHASE_2_MEMO_KEYS.bull.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: BULL_CONSOLIDATION_PROMPT,
  user: (_input, ctx) => {
    const entries = readContributions(ctx);
    const ticker = ctx.session.state.ticker as string;
    const date = ctx.session.state.date as string;
    return [
      `Ticker: ${ticker}`,
      `As-of date: ${date}`,
      "",
      "## Phase 1 — Analyst memos",
      formatAnalystMemos(ctx.resources.memos as any),
      "",
      "## Bull-side contributions in the debate",
      formatStanceContributions(entries, PHASE_2_MEMO_KEYS.bull.agentName),
      "",
      "## Bear-side contributions (for context — rebut where appropriate)",
      formatStanceContributions(entries, PHASE_2_MEMO_KEYS.bear.agentName),
      "",
      "Now write the published Bull memo.",
    ].join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: bullThesisOutputSchema,
});

export const consolidateBearMemo = generator({
  name: "consolidate-bear-memo",
  agentType: "sub",
  agentName: PHASE_2_MEMO_KEYS.bear.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: BEAR_CONSOLIDATION_PROMPT,
  user: (_input, ctx) => {
    const entries = readContributions(ctx);
    const ticker = ctx.session.state.ticker as string;
    const date = ctx.session.state.date as string;
    return [
      `Ticker: ${ticker}`,
      `As-of date: ${date}`,
      "",
      "## Phase 1 — Analyst memos",
      formatAnalystMemos(ctx.resources.memos as any),
      "",
      "## Bear-side contributions in the debate",
      formatStanceContributions(entries, PHASE_2_MEMO_KEYS.bear.agentName),
      "",
      "## Bull-side contributions (for context — rebut where appropriate)",
      formatStanceContributions(entries, PHASE_2_MEMO_KEYS.bull.agentName),
      "",
      "Now write the published Bear memo.",
    ].join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: bearThesisOutputSchema,
});

/**
 * Research manager — `agentType: "primary"` because per the design, RM
 * emits the InvestmentThesis structured row in the transcript and is
 * treated as a primary identity (not a sub-agent like the consolidators).
 */
export const researchManagerGenerator = generator({
  name: "research-manager-generator",
  agentType: "primary",
  agentName: PHASE_2_MEMO_KEYS.researchManager.agentName,
  model: (_input, ctx) =>
    modelFor((ctx.session.state.costPreset as "fast" | "full" | undefined) ?? "fast"),
  prompt: RESEARCH_MANAGER_PROMPT,
  user: (_input, ctx) => {
    const entries = readContributions(ctx);
    const ticker = ctx.session.state.ticker as string;
    const date = ctx.session.state.date as string;
    const bullMemoRef = ctx.resources.memos.getOptional(
      PHASE_2_MEMO_KEYS.bull.collectionKey,
    );
    const bearMemoRef = ctx.resources.memos.getOptional(
      PHASE_2_MEMO_KEYS.bear.collectionKey,
    );
    return [
      `Ticker: ${ticker}`,
      `As-of date: ${date}`,
      "",
      "## Phase 1 — Analyst memos",
      formatAnalystMemos(ctx.resources.memos as any),
      "",
      "## Phase 2 — Bull memo",
      formatMemoBlock("Bull thesis", bullMemoRef?.state),
      "",
      "## Phase 2 — Bear memo",
      formatMemoBlock("Bear thesis", bearMemoRef?.state),
      "",
      "## Full debate transcript",
      formatFullDebate(entries),
      "",
      "Synthesize the InvestmentThesis. Enumerate `unresolvedDisagreements`",
      "explicitly. Empty is acceptable only if the debate genuinely converged",
      "and you justify that in the \"Resolution of the debate\" body section.",
    ].join("\n");
  },
  resources: generatorResources,
  sessionStateSchema,
  outputSchema: investmentThesisOutputSchema,
});
