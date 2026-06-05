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
import { AGENTS, PHASE_1_MEMO_KEYS } from "../registry";
import type { CitationIntegrity } from "../resources";
import type { PortfolioContextInput } from "../flow-schema";
import type { LensConvergenceState } from "../agents/lenses/lens-convergence-resource";

/** Render a memo state as a compact prompt block. Permissive `any` —
 *  body shape is enforced by `memoStateSchema` at write time, so reads
 *  are trustworthy enough for prompt rendering. */
export function formatMemoBlock(label: string, memo: any): string {
  if (memo === undefined || memo === null || memo.headline == null) {
    return `## ${label}\n(no memo available)`;
  }
  const lines = [`## ${label}`];
  // Phase 1 data-grounding guard (FIX-681): flag memos whose primary data
  // source was unavailable so downstream agents skip synthesizing from them.
  if (memo.dataQuality === "unavailable") {
    lines.push("(unavailable — do not synthesize from this)");
  }
  lines.push(`Rating: ${memo.rating ?? "—"}`, `Headline: ${memo.headline}`);
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
    // Number each dependency so a downstream consumer (the Phase 5 PM) can
    // reference it by index in `traderDependencyDispositions` rather than
    // re-typing the text. Indices follow array order, which is the order
    // the Phase 5 writer's lineage check walks.
    lines.push("Depends on (unresolved):");
    memo.dependsOn.forEach((d: string, i: number) => lines.push(`- [${i}] ${d}`));
  }
  return lines.length > 0 ? lines.join("\n") : "(trade fields empty)";
}

/** Render the Phase 4 RiskAssessment memo's structured fields. */
export function formatRiskAssessmentExtensions(memo: any): string {
  if (memo === undefined || memo === null) {
    return "(no risk assessment available)";
  }
  const lines: string[] = [];
  if (Array.isArray(memo.criticalRisks) && memo.criticalRisks.length > 0) {
    lines.push("Critical risks:");
    for (const r of memo.criticalRisks as Array<{
      description: string;
      raisedBy: string;
      severity: string;
    }>) {
      lines.push(`- [${r.severity}] (raised by ${r.raisedBy}) ${r.description}`);
    }
  }
  if (Array.isArray(memo.dismissedRisks) && memo.dismissedRisks.length > 0) {
    lines.push("Dismissed risks:");
    for (const d of memo.dismissedRisks as Array<{
      description: string;
      reason: string;
      dismissalCategory?: string;
    }>) {
      const category = d.dismissalCategory ? ` [${d.dismissalCategory}]` : "";
      lines.push(`- ${d.description}${category} — ${d.reason}`);
    }
  }
  if (memo.recommendedAdjustments != null) {
    const ra = memo.recommendedAdjustments as Record<
      string,
      { direction: string; rationale: string; attributedTo: string } | null
    >;
    lines.push("Recommended adjustments:");
    for (const axis of ["sizing", "holdingPeriod", "invalidation"] as const) {
      const entry = ra[axis];
      if (entry == null) continue;
      lines.push(
        `- ${axis}: ${entry.direction} (attributed to ${entry.attributedTo}) — ${entry.rationale}`,
      );
    }
  }
  if (memo.confidenceCalibration != null) {
    lines.push(`Confidence calibration: ${memo.confidenceCalibration}`);
  }
  if (memo.calibrationRationale != null && memo.calibrationRationale !== "") {
    lines.push(`Calibration rationale: ${memo.calibrationRationale}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(risk-assessment fields empty)";
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

/** Render the Phase 5 ScenarioForecast memo's typed extension fields
 *  as a `<scenarioForecast>` block for PM consumption. */
export function formatScenarioForecastExtensions(memo: any): string {
  if (memo === undefined || memo === null) {
    return "(no scenario forecast available)";
  }
  const lines: string[] = [];
  if (memo.distribution != null) lines.push(`Distribution: ${memo.distribution}`);
  if (memo.evidenceBasis != null) lines.push(`Evidence basis: ${memo.evidenceBasis}`);
  if (memo.horizon != null) lines.push(`Horizon: ${memo.horizon}`);
  if (Array.isArray(memo.scenarios) && memo.scenarios.length > 0) {
    lines.push("Scenarios:");
    for (const s of memo.scenarios as Array<{
      name: string;
      probability: number;
      trigger: string;
      triggerSource: string;
      expectedOutcome: string;
      tradeBehavior: string;
    }>) {
      lines.push(
        `- ${s.name} · ${(s.probability * 100).toFixed(0)}% · trigger: ${s.trigger} [${s.triggerSource}] · outcome: ${s.expectedOutcome} · trade: ${s.tradeBehavior}`,
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : "(scenario-forecast fields empty)";
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

/** Render the Phase 1 analyst memos as a compact block. */
export async function formatAnalystMemos(memos: {
  getOptional: (k: string) => Promise<{ state: any } | undefined>;
}): Promise<string> {
  const blocks: string[] = [];
  for (const [, mapping] of Object.entries(PHASE_1_MEMO_KEYS)) {
    const ref = await memos.getOptional(mapping.collectionKey);
    const role = AGENTS[mapping.agentName].role;
    blocks.push(formatMemoBlock(`${role}`, ref?.state));
  }
  return blocks.join("\n\n");
}

/** Render contributions filtered to one stance, grouped by round. Returns
 *  a sentinel string when no entries match (so context renderers don't emit
 *  a blank tag). */
export function formatStanceContributions(
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

/** Flatten an analyst memo's structured body into one string per section
 *  (heading + paragraph + list items). Shared by the Phase 2 citation
 *  auditor (which joins the sections and substring-checks quotes against
 *  them) and `find_counter_evidence` (which treats each section as a search
 *  candidate). Returns `[]` when the memo has no body. */
export function memoSectionTexts(state: unknown): string[] {
  const body = (
    state as
      | { body?: Array<{ h: string; p: string | null; items: string[] | null }> }
      | undefined
  )?.body;
  if (!Array.isArray(body)) return [];
  return body.map((s) => [s.h, s.p ?? "", ...(s.items ?? [])].join(" "));
}

/** Collapse internal whitespace runs to single spaces and trim. Used so
 *  substring/quote matching isn't defeated by formatting differences
 *  between a memo's stored body and a re-typed quote. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Render the Phase 2 citation-integrity report (FIX-679) for the Research
 *  Manager's prompt. Returns `""` when no report exists (so the context tag
 *  is suppressed) and a terse summary otherwise — the invalid-tag list is
 *  the load-bearing part: it tells the RM which attributed claims failed
 *  verbatim verification and should be discounted in synthesis. */
export function formatCitationIntegrity(
  report: CitationIntegrity | null | undefined,
): string {
  if (report == null || report.tagsChecked === 0) return "";
  const lines = [
    `${report.tagsValid}/${report.tagsChecked} memo citations verified verbatim.`,
  ];
  if (report.invalidTags.length > 0) {
    lines.push(
      "Unverified citations (quote not found in the named memo — discount these claims):",
    );
    for (const t of report.invalidTags) {
      lines.push(`- ${t.contribution} cited [memo:${t.tag}] "${t.attemptedQuote}"`);
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

/**
 * Render the frozen per-run portfolio snapshot as the `<portfolioContext>`
 * prompt block for the trader (P3) and PM (P5). Two consumers → shared here
 * (BP-018). Best-effort from whatever the client supplied at dispatch; it must
 * never throw.
 *
 * Real-money discipline:
 *  - Numbers trace to stored qty × a sourced quote — this only renders what the
 *    snapshot carries; it fabricates nothing.
 *  - A holding whose price was unknown has `marketValue: null` / `weightPct:
 *    null` → rendered as "price unavailable", never a guessed value.
 *  - `snapshotAsOf` is surfaced so the model labels the snapshot as as-of, not
 *    live (RISK-P3); coverage ("priced X of Y") is stated honestly.
 *  - The existing position in `<ticker>` is computed by summing this snapshot's
 *    own rows for the ticker — no recomputation against external data.
 *
 * Returns `null` when no portfolio was supplied so the capability's XML renderer
 * suppresses the tag entirely (portfolio-blind run, exactly as today).
 */
export function formatPortfolioContext(
  portfolio: PortfolioContextInput | null | undefined,
  selectedAccountIds: string[] | null | undefined,
  ticker: string,
): string | null {
  // Guard on the required `accounts` array (not just null): a partial/empty
  // snapshot suppresses the tag rather than throwing on a missing field.
  if (
    portfolio == null ||
    typeof portfolio !== "object" ||
    !Array.isArray((portfolio as Partial<PortfolioContextInput>).accounts) ||
    !Array.isArray((portfolio as Partial<PortfolioContextInput>).holdings)
  ) {
    return null;
  }
  const tickerUpper = ticker.toUpperCase();
  const selected = new Set(selectedAccountIds ?? []);
  const accountById = new Map(portfolio.accounts.map((a) => [a.id, a]));

  const lines: string[] = [];
  lines.push(
    `Total portfolio NAV: ~$${portfolio.totalNav.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    })} (display approximation).`,
  );
  if (portfolio.snapshotAsOf != null && portfolio.snapshotAsOf !== "") {
    lines.push(
      `Snapshot as of ${portfolio.snapshotAsOf} — frozen at run start, NOT live. Treat positions as a snapshot.`,
    );
  }
  lines.push(
    `Price coverage: ${portfolio.pricedHoldings} of ${portfolio.totalHoldings} holdings priced; ` +
      `unpriced holdings have no market value (do not assume one).`,
  );

  // Existing position in the analyzed ticker — summed from this snapshot's rows.
  const tickerRows = portfolio.holdings.filter(
    (h) => h.ticker.toUpperCase() === tickerUpper,
  );
  if (tickerRows.length > 0) {
    const knownValue = tickerRows
      .filter((h) => h.marketValue != null)
      .reduce((s, h) => s + (h.marketValue ?? 0), 0);
    const knownWeight = tickerRows
      .filter((h) => h.weightPct != null)
      .reduce((s, h) => s + (h.weightPct ?? 0), 0);
    const accountsHolding = tickerRows
      .map((h) => accountById.get(h.account)?.label ?? h.account)
      .join(", ");
    lines.push(
      `Existing position in ${tickerUpper}: held in ${accountsHolding}; ` +
        `current weight ~${knownWeight.toFixed(2)}% of NAV (~$${knownValue.toLocaleString(
          "en-US",
          { maximumFractionDigits: 0 },
        )}).`,
    );
  } else {
    lines.push(`Existing position in ${tickerUpper}: none — this would initiate a position.`);
  }

  // Accounts — flag which are in the user's selection.
  lines.push("Accounts:");
  for (const acc of portfolio.accounts) {
    const mark = selected.size > 0 && selected.has(acc.id) ? " [selected for this trade]" : "";
    lines.push(
      `- ${acc.label} (${acc.type}): ~$${acc.cash.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      })} investable cash${mark}.`,
    );
  }

  // Top weights for a concentration read (best-effort; only priced rows).
  const priced = portfolio.holdings.filter((h) => h.weightPct != null);
  if (priced.length > 0) {
    const top = [...priced]
      .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
      .slice(0, 6)
      .map((h) => `${h.ticker.toUpperCase()} ${(h.weightPct ?? 0).toFixed(1)}%`)
      .join(", ");
    lines.push(`Top positions by weight: ${top}.`);
  }

  return lines.join("\n");
}

/**
 * Render the deterministic lens-convergence summary as the `<lensConvergence>`
 * prompt block the PM reasons with to size `portfolioFit`. Single render path
 * (no LLM re-narration). Frames convergence as ROBUSTNESS, not truth (real-money
 * gate §1.6): "robust across philosophies", never "high probability of being
 * right". Returns `null` (tag suppressed) when the pack did not run.
 */
export function formatLensConvergence(
  convergence: LensConvergenceState | null | undefined,
): string | null {
  // A registered-but-unwritten nullable single resource can surface as `{}` (an
  // empty object), not `null`, in the generator context. Guard on the required
  // `classification` field so a not-yet-computed read suppresses the tag rather
  // than throwing on a missing field (fast preset → pack skipped).
  if (
    convergence == null ||
    typeof convergence !== "object" ||
    (convergence as Partial<LensConvergenceState>).classification == null
  ) {
    return null;
  }
  const { classification, agreementScore, netLean, majorityStance, verdicts, dissenters } =
    convergence;
  const lines: string[] = [];
  lines.push(
    `Independent investor lenses re-read the SAME post-Phase-2 evidence (not a debate). ` +
      `Each applies a documented methodology — robustness across philosophies, NOT a probability of being right.`,
  );
  lines.push(
    `Read: ${classification.toUpperCase()} · majority ${majorityStance} · ` +
      `agreement ${(agreementScore * 100).toFixed(0)}% · netLean ${netLean >= 0 ? "+" : ""}${netLean.toFixed(2)}.`,
  );
  if (verdicts.length > 0) {
    lines.push("Per-lens verdicts:");
    for (const v of verdicts) {
      const dissent = dissenters.includes(v.lensId) ? " (dissents from majority)" : "";
      const gap = v.dataGap !== "" ? ` [data gap: ${v.dataGap}]` : "";
      lines.push(
        `- ${v.label} (${v.attribution}): ${v.stance} @ ${v.conviction.toFixed(2)}${dissent} — ${v.keyDriver}${gap}`,
      );
    }
  }
  lines.push(
    `Sizing rule: a CONVERGENT read permits the PM's full sizing; MIXED/DIVERGENT pulls toward a ` +
      `smaller target or hold. Robustness adjusts size DOWN on divergence only — it never inflates a position.`,
  );
  return lines.join("\n");
}
