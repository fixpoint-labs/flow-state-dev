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
import { AGENTS, ALL_MEMO_KEYS, PHASE_1_MEMO_KEYS } from "../registry";
import type { CitationIntegrity } from "../resources";
import type { PortfolioContextInput } from "../flow-schema";
import type { LensConvergenceState } from "../agents/lenses/lens-convergence-resource";
import type { RewardToRiskState } from "../reward-to-risk-resource";
import type { RiskMandate } from "./risk-mandate";
import type { ThesisRecord } from "@/domain/portfolio/schema/thesis-schema";
import {
  timeHorizonCategoryFor,
  type PortfolioMandate,
} from "@/domain/portfolio/schema/portfolio-mandate-schema";

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
      expectedReturnPct?: number | null;
      tradeBehavior: string;
    }>) {
      const ret =
        s.expectedReturnPct != null
          ? ` (${s.expectedReturnPct >= 0 ? "+" : ""}${s.expectedReturnPct}%)`
          : "";
      lines.push(
        `- ${s.name} · ${(s.probability * 100).toFixed(0)}% · trigger: ${s.trigger} [${s.triggerSource}] · outcome: ${s.expectedOutcome}${ret} · trade: ${s.tradeBehavior}`,
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

/**
 * Render the desk's "references consulted" ledger (FIX-676) as the
 * `<referencesConsulted>` prompt block.
 *
 * The ledger is DERIVED from the `citations` already stored on every memo —
 * there is no separate resource. The Phase 1 analysts' investigative fetches
 * (the `investigate` preset) and the synthesis corroborators (the `corroborate`
 * preset) both write the URLs they fetched into their memo's `citations`, so the
 * memos collection IS the ledger. Reading it lets a downstream agent reuse a
 * link the desk already surfaced instead of re-searching the same ground.
 *
 * Walks `ALL_MEMO_KEYS` (so a new participant is picked up automatically),
 * collects each memo's `citations`, dedups by URL (first citer wins), and
 * attributes each to the citing agent's role. Returns `null` (tag suppressed)
 * when nothing has been cited yet — the steady state on the `fast` preset, where
 * no agent fetches. Permissive reads: `citations` is enforced by
 * `memoStateSchema` at write time, so a present array is trustworthy enough for
 * prompt rendering.
 */
export async function formatReferencesConsulted(memos: {
  getOptional: (k: string) => Promise<{ state: any } | undefined>;
}): Promise<string | null> {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const [, mapping] of Object.entries(ALL_MEMO_KEYS)) {
    const ref = await memos.getOptional(mapping.collectionKey);
    const citations = (ref?.state as { citations?: unknown } | undefined)
      ?.citations;
    if (!Array.isArray(citations)) continue;
    const role = AGENTS[mapping.agentName]?.role ?? mapping.agentName;
    for (const c of citations as Array<{ url?: unknown; title?: unknown }>) {
      if (
        c == null ||
        typeof c.url !== "string" ||
        c.url === "" ||
        seen.has(c.url)
      ) {
        continue;
      }
      seen.add(c.url);
      const title =
        typeof c.title === "string" && c.title !== "" ? c.title : c.url;
      entries.push(`- "${title}" — ${c.url} (consulted by ${role})`);
    }
  }
  if (entries.length === 0) return null;
  // Self-wrap the tag (the `<corroboration>`/`<reviewReferences>` clauses point
  // agents at `<referencesConsulted>`). This string is contributed VERBATIM via
  // the preset's array context, so the tag renders exactly once, unescaped — see
  // the `corroborate` preset note in `capability.ts`.
  return [
    "<referencesConsulted>",
    "Sources the desk's analysts and prior synthesis agents have already",
    "consulted on the open web. Reuse one of these — you may `fetch` a URL to",
    "read it in full — rather than re-searching the same ground:",
    ...entries,
    "</referencesConsulted>",
  ].join("\n");
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

  // Household-health aggregate (FIX-762) — the deterministic exposure /
  // concentration / sector read, so the model reasons about the book, not just a
  // position list. Rendered only when computable; drift (FIX-761) is omitted
  // until that slice lands.
  appendHealthLines(lines, portfolio.health);

  return lines.join("\n");
}

/** Percent (0..100) as "12.4%", or "—" when unknown. */
function fmtPct(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

/** Append the compact `<portfolioContext>` health block. No-op when health is
 *  absent (portfolio-blind on the health axis). */
function appendHealthLines(lines: string[], health: PortfolioContextInput["health"]): void {
  if (health == null) return;
  lines.push(
    `Household health (deterministic): cash ${fmtPct(health.cashPct)} of NAV, ` +
      `priced coverage ${fmtPct(health.coveragePct)}.`,
  );
  if (health.assetClassAllocation.length > 0) {
    const alloc = health.assetClassAllocation
      .map((a) => `${a.assetClass} ${fmtPct(a.pct)}`)
      .join(", ");
    lines.push(`Allocation by class: ${alloc}.`);
  }
  const c = health.concentration;
  const maxName = c.maxPosition ? `${c.maxPosition.ticker} ${fmtPct(c.maxPosition.weightPct)}` : "—";
  lines.push(
    `Concentration (of invested NAV): largest name ${maxName}; top-5 ${fmtPct(c.top5Pct)}; ` +
      `effective positions ${c.effectivePositions == null ? "—" : c.effectivePositions.toFixed(1)}.`,
  );
  if (c.flags.length > 0) lines.push(`Concentration flags: ${c.flags.join(", ")}.`);
  if (health.sectorExposure.length > 0) {
    const sectors = health.sectorExposure.map((s) => `${s.bucket} ${fmtPct(s.pct)}`).join(", ");
    lines.push(`Sector exposure: ${sectors}.`);
  }
  if (health.drift != null) {
    lines.push(
      `Drift vs mandate: total ${fmtPct(health.drift.totalDriftPct)}` +
        `${health.drift.rebalanceSuggested ? " — rebalance suggested" : ""}` +
        `${health.drift.breaches.length > 0 ? ` (${health.drift.breaches.join("; ")})` : ""}.`,
    );
  }
  appendLookThroughLines(lines, health.lookThrough);
}

/** Append the ETF look-through second axis (FIX-801) — a separate line, not
 *  folded into the wrapper-basis lines above (Decision 2: additive, never a
 *  replacement). No-op when nothing was attributed through a fund (`null`) —
 *  which covers both the honest "no funds held" case and, on a headless run,
 *  the documented Decision 1 divergence (the seed reads stored profiles
 *  read-only and never fetches, so a fund nobody has warmed via the Portfolio
 *  pane simply doesn't appear here). `maxPosition`/coverage are explicitly
 *  framed as a LOWER BOUND, and the line states plainly that this reading does
 *  NOT move the deterministic decision gates — a household 25% in a name
 *  through funds still clears a policy cap measured on the wrapper basis
 *  (spec Non-goals; the model must not read a look-through flag as a gate). */
function appendLookThroughLines(
  lines: string[],
  lookThrough: NonNullable<PortfolioContextInput["health"]>["lookThrough"],
): void {
  if (lookThrough == null) return;
  const maxName = lookThrough.maxPosition
    ? `${lookThrough.maxPosition.ticker} ${fmtPct(lookThrough.maxPosition.weightPct)}`
    : "—";
  // The look-through analogue of the wrapper-basis `effective positions`
  // figure, but an interval (not a point estimate) — the unattributed
  // residual could sit anywhere from a long tail to piling entirely onto the
  // largest name already seen (Decision 4, docs/etf-look-through.md). Was
  // computed by the leaf but never surfaced here until now (Codex review,
  // FIX-801 sub-PR c).
  const effPositions =
    lookThrough.effectivePositions == null
      ? "—"
      : `${lookThrough.effectivePositions.low.toFixed(1)}–${lookThrough.effectivePositions.high.toFixed(1)}`;
  lines.push(
    `ETF look-through (seeing inside funds; a LOWER BOUND — does not move sizing gates): ` +
      `name coverage ${fmtPct(lookThrough.coveragePct)}, sector coverage ${fmtPct(lookThrough.sectorCoveragePct)}, ` +
      `largest effective name ${maxName}, effective positions ${effPositions} (interval — residual placement is uncertain)` +
      `${opaqueFundsSuffix(lookThrough)}.`,
  );
  if (lookThrough.flags.length > 0) {
    lines.push(`Look-through concentration flags: ${lookThrough.flags.join(", ")}.`);
  }
  // The actual attributed sector distribution, not just its coverage number —
  // an ordinary diversified fund allocation that never crosses the warn
  // threshold produces no flag, so without this line the model only ever sees
  // a coverage percentage for it, never what it's actually IN (Codex review,
  // FIX-801 sub-PR c round 28, same spirit as the opaque-fund detail below).
  if (lookThrough.sectorExposure.length > 0) {
    const sectors = lookThrough.sectorExposure.map((s) => `${s.bucket} ${fmtPct(s.pct)}`).join(", ");
    lines.push(`Look-through sector exposure: ${sectors}.`);
  }
  // Per-fund identity behind the counts above: WHICH wrapper, on WHICH axis,
  // for WHY — the summary line's counts alone give the model no way to trace
  // "1 fund opaque" back to a specific holding, risking a warning attributed
  // to the wrong one (Codex review, FIX-801 sub-PR c round 25). One clause per
  // `OpaqueFund` entry (not deduped by ticker — a fund thin on names but fine
  // on sectors has two distinct, both-preserved reasons; see
  // `opaqueFundDetails`'s docblock in `build-portfolio-context.ts`).
  if (lookThrough.opaqueFundDetails.length > 0) {
    const details = lookThrough.opaqueFundDetails
      .map(
        (f) =>
          `${f.ticker} (${f.axis}: ${f.reason}${f.unavailable ? ", not yet available" : ""})`,
      )
      .join("; ");
    lines.push(`Opaque fund detail: ${details}.`);
  }
}

/**
 * The opaque-fund clause of the look-through line, split by WHY a fund is
 * opaque so the model doesn't read "not yet available" as a data-quality
 * finding (Codex review, FIX-801 sub-PR c): `opaqueUnavailableFundCount` (never
 * fetched, or quota/rate-limited and pending retry) is reported separately
 * from the remainder, which is a genuine thin/malformed/ineligible-data
 * judgment.
 */
function opaqueFundsSuffix(
  lookThrough: NonNullable<NonNullable<PortfolioContextInput["health"]>["lookThrough"]>,
): string {
  const dataQualityCount = lookThrough.opaqueFundCount - lookThrough.opaqueUnavailableFundCount;
  const clauses: string[] = [];
  if (dataQualityCount > 0) {
    clauses.push(`${dataQualityCount} fund(s) opaque (thin/ineligible data)`);
  }
  if (lookThrough.opaqueUnavailableFundCount > 0) {
    clauses.push(`${lookThrough.opaqueUnavailableFundCount} fund(s) not yet available (unfetched or temporarily rate/quota-limited)`);
  }
  return clauses.length > 0 ? `; ${clauses.join(", ")}` : "";
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

/**
 * Render the scenario-derived reward-to-risk figure as the `<rewardToRisk>`
 * prompt block the PM judges against the mandate (FIX-752). Documented
 * methodology, not a probability of being right. Returns `null` (tag suppressed)
 * when the resource has not been computed — a registered-but-unwritten nullable
 * resource can surface as `{}`, so the guard is on the required `evidenceBasis`.
 */
export function formatRewardToRisk(
  figure: RewardToRiskState | null | undefined,
): string | null {
  if (
    figure == null ||
    typeof figure !== "object" ||
    (figure as Partial<RewardToRiskState>).evidenceBasis == null
  ) {
    return null;
  }
  const pct = (n: number | null) =>
    n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const ratio = (n: number | null) =>
    n == null ? "n/a (no downside scenario)" : n.toFixed(2);
  const lines: string[] = [];
  lines.push(
    "Reward-to-risk, derived deterministically from the scenario distribution (documented methodology, NOT a probability of being right):",
  );
  lines.push(
    `- Probability-weighted upside ${pct(figure.expectedGainPct)} vs downside ${pct(
      figure.expectedLossPct == null ? null : -figure.expectedLossPct,
    )}.`,
  );
  lines.push(
    `- Gain/Loss ratio ${ratio(figure.glr)}; loss-adjusted (λ=${figure.lossAversion}) ${ratio(
      figure.lossAdjustedGlr,
    )}.`,
  );
  lines.push(
    `- Expected value ${pct(figure.expectedValuePct)}; worst-case bucket ${pct(
      figure.worstCaseReturnPct,
    )}.`,
  );
  if (figure.noDownside) {
    lines.push(
      "- No scenario is negative — the reward-to-risk floor is treated as cleared (worst-case and confidence gates still apply).",
    );
  }
  lines.push(
    `- Evidence basis: ${figure.evidenceBasis}${
      figure.evidenceBasis === "thin" ? " — treat the figure as indicative only" : ""
    }.`,
  );
  return lines.join("\n");
}

/**
 * Render the active risk-appetite mandate as the `<riskMandate>` prompt block.
 * Frames the mandate as a documented, user-set standard (NOT advice) and states
 * the worth-it bar + the sizing appetite (FIX-752). Agent-agnostic: this shared
 * block feeds BOTH the trader and the PM, so it carries no output-field
 * directives (the PM prompt's rule 11 owns the `portfolioFit` / override
 * mechanics, which only the PM can emit). Returns `null` (tag suppressed) when
 * the run is mandate-blind (the `userThesis`/`portfolioContext` precedent).
 */
export function formatRiskMandate(
  mandate: RiskMandate | null | undefined,
): string | null {
  if (
    mandate == null ||
    typeof mandate !== "object" ||
    (mandate as Partial<RiskMandate>).id == null
  ) {
    return null;
  }
  const lines: string[] = [];
  lines.push(
    `The book's risk-appetite mandate is "${mandate.label}" — a documented, user-set standard (NOT financial advice): ${mandate.description}`,
  );
  lines.push("Worth-it bar this name must clear:");
  lines.push(
    `- Loss-adjusted reward-to-risk ≥ ${mandate.rewardToRiskFloor.toFixed(1)} (downside weighted ${mandate.lossAversion}×).`,
  );
  lines.push(`- Expected return ≥ ${mandate.hurdleReturnPct}% (hurdle / opportunity cost).`);
  lines.push(`- Decision confidence ≥ ${mandate.confidenceFloor.toFixed(2)}.`);
  lines.push(
    `- No scenario worse than -${mandate.maxTolerableLossPct}% (capacity line — a worse worst case hard-caps the size and cannot be overridden).`,
  );
  lines.push(
    `Sizing appetite: a name that CLEARS the bar is sized to about ${(mandate.kellyFraction * 100).toFixed(
      0,
    )}% of a full-Kelly stake (fractional-Kelly); a name that does NOT clear is held to a token size (at or below ${mandate.unclearedCapPct}% of NAV). The mandate only ever reduces size, never inflates it, and never changes the rating.`,
  );
  return lines.join("\n");
}

/**
 * Render the user's STANDING per-position thesis (FIX-760) as the inner content
 * of the `<standing-thesis>` prompt block the trader (P3) and PM (P5) reason with.
 * This is the durable "why we hold this name" — distinct from the per-run
 * `<userThesis>` (the hypothesis the Phase 6 validator audits): the standing
 * thesis is CONTEXT the decision tier sees, like position size, never the run's
 * hypothesis-under-test. The analysts stay blind to it.
 *
 * Guards on the required `entryRationale` (BP-018, the `formatPortfolioContext`
 * precedent): a partial/empty read (a nullable single resource that surfaced as
 * `{}`) suppresses the tag rather than throwing. Returns the inner content; the
 * capability's object-form context key auto-wraps it as the kebab-case
 * `<standing-thesis>` tag (the `portfolioContext` / `riskMandate` precedent).
 */
export function formatStandingThesis(
  thesis: ThesisRecord | null | undefined,
): string | null {
  if (
    thesis == null ||
    typeof thesis !== "object" ||
    typeof (thesis as Partial<ThesisRecord>).entryRationale !== "string" ||
    (thesis as Partial<ThesisRecord>).entryRationale === ""
  ) {
    return null;
  }
  const lines: string[] = [];
  lines.push(
    "The user holds this name with a STANDING thesis — their durable reason for the position, NOT a hypothesis to test. Treat it as standing intent (like position size); do not let it bias the evidence, but weigh it when sizing and deciding.",
  );
  if (thesis.updatedAt) {
    lines.push(`Recorded as of ${thesis.updatedAt.slice(0, 10)}.`);
  }
  lines.push(`Entry rationale: ${thesis.entryRationale}`);
  if (thesis.timeHorizon != null) {
    lines.push(`Intended horizon: ${thesis.timeHorizon}.`);
  }
  const levels: string[] = [];
  if (thesis.targetPrice != null) levels.push(`target ~$${thesis.targetPrice}`);
  if (thesis.stopPrice != null) levels.push(`stop ~$${thesis.stopPrice}`);
  if (levels.length > 0) lines.push(`Levels: ${levels.join(", ")}.`);
  if (thesis.invalidationConditions != null && thesis.invalidationConditions !== "") {
    lines.push(`What would make this wrong: ${thesis.invalidationConditions}`);
  }
  if (thesis.tripwires.length > 0) {
    lines.push("Tripwires (observable falsifiers):");
    for (const t of thesis.tripwires) {
      const detail =
        t.kind === "price" && t.level != null
          ? ` (price ${t.level})`
          : t.byDate != null
            ? ` (by ${t.byDate})`
            : "";
      lines.push(`- [${t.kind}] ${t.note}${detail}`);
    }
  }
  return lines.join("\n");
}

/**
 * Render the durable household portfolio mandate (IPS, FIX-761) as the inner
 * content of the `<portfolioMandate>` prompt block the PM (P5) reasons with —
 * objectives, target allocation + rebalancing bands, standing constraints, and
 * time horizon. States which constraints are HARD (the `maxPositionWeight` cap +
 * the analyzed-name exclusion, enforced deterministically at commit) versus
 * ADVISORY (min-cash + allocation drift, which the single-ticker PM narrates but
 * cannot mechanically enforce), and calls out whether the analyzed name is
 * excluded or capped so the PM's narration is legible.
 *
 * Guards on the required `createdAt` (BP-018, the `formatStandingThesis`
 * precedent): a partial/empty read (a nullable single resource that surfaced as
 * `{}`) suppresses the tag rather than throwing. Returns the inner content; the
 * capability's object-form context key auto-wraps it as `<portfolioMandate>`.
 */
export function formatPortfolioMandate(
  mandate: PortfolioMandate | null | undefined,
  ticker: string,
): string | null {
  if (
    mandate == null ||
    typeof mandate !== "object" ||
    typeof (mandate as Partial<PortfolioMandate>).createdAt !== "string"
  ) {
    return null;
  }
  const tickerUpper = ticker.toUpperCase();
  const lines: string[] = [];
  lines.push(
    `The household's durable portfolio mandate (Investment Policy Statement) — "${mandate.label}", a documented, user-set standing policy (NOT financial advice). Size this name with these standing rules in view.`,
  );

  const obj = mandate.objectives;
  const ret =
    obj.returnTargetPct != null
      ? `; target return ~${obj.returnTargetPct}%${obj.returnBasis != null ? ` (${obj.returnBasis})` : ""}`
      : "";
  lines.push(`Objective: ${obj.riskTolerance} risk tolerance${ret}.`);

  if (mandate.timeHorizon.years != null) {
    const cat = timeHorizonCategoryFor(mandate.timeHorizon.years);
    lines.push(
      `Time horizon: ~${mandate.timeHorizon.years} years${cat != null ? ` (${cat}-term)` : ""}.`,
    );
  }

  if (mandate.targetAllocation.length > 0) {
    lines.push(
      "Target allocation over asset classes (ADVISORY — drift is the health view's measure, not enforced here):",
    );
    for (const a of mandate.targetAllocation) {
      const corridor =
        a.minPct != null || a.maxPct != null
          ? ` [${a.minPct ?? "—"}–${a.maxPct ?? "—"}%]`
          : "";
      lines.push(`- ${a.assetClass}: ${a.targetPct}%${corridor}`);
    }
    const band = mandate.rebalancing;
    lines.push(
      band.bandType === "relative"
        ? `Rebalancing band: ±${(band.bandWidthPct * 100).toFixed(0)}% of each target (relative).`
        : `Rebalancing band: ±${band.bandWidthPct}pp from each target (absolute).`,
    );
  }

  const c = mandate.constraints;
  lines.push("Standing constraints:");
  if (c.maxPositionWeightPct != null) {
    lines.push(
      `- Max single-position weight ${c.maxPositionWeightPct}% of NAV (HARD, at purchase — the commit clamps size to it).`,
    );
  }
  if (c.minCashPct != null) {
    lines.push(
      `- Minimum cash ${c.minCashPct}% of NAV (ADVISORY — a single-name run can't enforce a portfolio cash floor; note it, do not fabricate a portfolio-level action).`,
    );
  }
  if (c.exclusions.length > 0) {
    lines.push(`- Exclusions (never add): ${c.exclusions.join(", ")}.`);
  }
  if (c.maxPositionWeightPct == null && c.minCashPct == null && c.exclusions.length === 0) {
    lines.push("- (none)");
  }

  const excluded = c.exclusions.some((e) => e.trim().toUpperCase() === tickerUpper);
  if (excluded) {
    lines.push(
      `NOTE: ${tickerUpper} is on the exclusion list — this run must NOT recommend adding to it (a no-add is enforced at commit).`,
    );
  } else if (c.maxPositionWeightPct != null) {
    lines.push(
      `NOTE: ${tickerUpper} is subject to the ${c.maxPositionWeightPct}% max-position cap — size at or below it (enforced at commit).`,
    );
  }

  return lines.join("\n");
}
