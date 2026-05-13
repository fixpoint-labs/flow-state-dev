/**
 * Shared prompt-formatting helpers for Phase 4 generators.
 *
 * Both `personas.ts` and `consolidator.ts` render memo state, prior
 * critiques, trade-proposal extension fields, and round-robin transcripts
 * into the user prompt. The helpers live here so the two files share one
 * source of truth — divergent copies previously caused a duplicate-header
 * bug in the persona prompts.
 */
import type {
  RoundRobinContributionEntry,
  RoundRobinContributionsState,
} from "@flow-state-dev/patterns/round-robin";
import { AGENTS, PHASE_1_MEMO_KEYS } from "../agents";

/** Render a memo state as a compact prompt block. Permissive `any` —
 *  body shape is enforced by `memoStateSchema` at write time, so reads
 *  are trustworthy enough for prompt rendering. */
export function formatMemoBlock(label: string, memo: any): string {
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

/** Render the Phase 3 trade-proposal memo's typed extension fields. */
export function formatTradeProposalExtensions(memo: any): string {
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
export function formatThesisExtensions(memo: any): string {
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

/** Render a Phase 4 persona memo's structured critique fields. The
 *  `formatMemoBlock` call below already emits `## ${label}` — callers do
 *  not add their own heading. */
export function formatPersonaCritique(label: string, memo: any): string {
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

/** Render the four Phase 1 analyst memos as a compact block. */
export function formatAnalystMemos(memos: {
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

/** Render a round-robin transcript grouped by round. Used for both the
 *  Phase 2 bull/bear debate and the Phase 4 risk-debate transcripts. */
export function formatDebate(entries: RoundRobinContributionEntry[]): string {
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

/** Read the `entries` array off a named contributions resource. Returns
 *  `[]` when the resource is missing or empty. */
export function readContributionsEntries(
  ctx: any,
  resourceName: string,
): RoundRobinContributionEntry[] {
  const state = ctx.resources?.[resourceName]?.state as
    | RoundRobinContributionsState
    | undefined;
  return state?.entries ?? [];
}
