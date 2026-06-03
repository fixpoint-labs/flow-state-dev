/**
 * Canonical agent identity table for the Trading Desk example.
 *
 * Mirrors the Claude Design handoff (2026-05-06) verbatim. All nineteen agents
 * across phases P1–P6 ship in this table from Phase 1 — the sidebar phase
 * groups for P2–P5 render in `pending` styling and become live as later
 * phases land.
 *
 * - `role`: human-readable label rendered in the transcript and memo header.
 * - `glyph`: 2-character mark inside the agent badge.
 * - `hue`: OKLCH hue (degrees) used for the per-agent accent color via the
 *   `--c` custom property in `AgentBadge`.
 * - `team`: phase grouping (analyst | research | trade | risk | pm) used by
 *   the sidebar to bucket entries.
 */
export type AgentTeam = "analyst" | "research" | "trade" | "risk" | "pm";

export type AgentMeta = {
  readonly role: string;
  readonly glyph: string;
  readonly hue: number;
  readonly team: AgentTeam;
};

export const AGENTS = {
  // Phase 1 — analyst fan-out
  fundamentalsAnalyst: { role: "Fundamentals Analyst", glyph: "Fn", hue: 28, team: "analyst" },
  sentimentAnalyst:    { role: "Sentiment Analyst",    glyph: "Sn", hue: 48, team: "analyst" },
  newsAnalyst:         { role: "News Analyst",         glyph: "Nw", hue: 78, team: "analyst" },
  technicalAnalyst:    { role: "Technical Analyst",    glyph: "Tc", hue: 138, team: "analyst" },
  companyProfileAnalyst: { role: "Company Profile Analyst", glyph: "Cp", hue: 200, team: "analyst" },
  marketAnalyst:         { role: "Market Analyst",          glyph: "Mk", hue: 108, team: "analyst" },
  macroAnalyst:          { role: "Macro Analyst",           glyph: "Ma", hue: 90, team: "analyst" },
  quantAnalyst:          { role: "Quant Analyst",           glyph: "Qt", hue: 168, team: "analyst" },
  disclosureAnalyst:     { role: "Disclosure Analyst",     glyph: "Dx", hue: 320, team: "analyst" },
  // Phase 2 — research debate
  bullResearcher:      { role: "Bull Researcher",      glyph: "B+", hue: 158, team: "research" },
  bearResearcher:      { role: "Bear Researcher",      glyph: "B-", hue: 18, team: "research" },
  researchManager:     { role: "Research Manager",     glyph: "RM", hue: 268, team: "research" },
  // Phase 3 — trader
  trader:              { role: "Trader",               glyph: "Tr", hue: 248, team: "trade" },
  // Phase 4 — risk debate
  aggressiveRisk:      { role: "Aggressive Risk",      glyph: "A!", hue: 8, team: "risk" },
  conservativeRisk:    { role: "Conservative Risk",    glyph: "C.", hue: 218, team: "risk" },
  neutralRisk:         { role: "Neutral Risk",         glyph: "N°", hue: 178, team: "risk" },
  riskAssessment:      { role: "Risk Assessment",     glyph: "R=", hue: 188, team: "risk" },
  // Phase 5 — portfolio management (scenario forecaster + portfolio manager)
  scenarioForecaster:  { role: "Scenario Forecaster",  glyph: "Sf", hue: 285, team: "pm" },
  portfolioManager:    { role: "Portfolio Manager",    glyph: "PM", hue: 298, team: "pm" },
  // Phase 6 — thesis audit (post-decision). Reuses the `pm` team so the
  // sidebar renders it in the existing PM color group rather than minting a
  // new team for a single agent.
  thesisValidator:     { role: "Thesis Validator",     glyph: "TV", hue: 318, team: "pm" },
  // Portfolio utility — broker-agnostic PDF statement extractor (Slice 4b).
  // Not part of the analysis pipeline; runs only on the `extractHoldingsFromPdf`
  // action. Reuses the `pm` team so it does not mint a new sidebar group for a
  // single utility agent that never appears in `PHASE_GROUPS`.
  statementParser:     { role: "Statement Parser",     glyph: "SP", hue: 60, team: "pm" },
} as const satisfies Record<string, AgentMeta>;

export type AgentName = keyof typeof AGENTS;

/** Phase grouping the sidebar uses to bucket entries (rendered top-down P5 → P1). */
export const PHASE_GROUPS: ReadonlyArray<{
  id: "p6" | "p5" | "p4" | "p3" | "p2" | "p1";
  label: string;
  agents: ReadonlyArray<AgentName>;
}> = [
  { id: "p6", label: "Phase 6 — Thesis Audit", agents: ["thesisValidator"] },
  { id: "p5", label: "Phase 5 — Portfolio Management", agents: ["scenarioForecaster", "portfolioManager"] },
  { id: "p4", label: "Phase 4 — Risk Debate", agents: ["aggressiveRisk", "conservativeRisk", "neutralRisk", "riskAssessment"] },
  { id: "p3", label: "Phase 3 — Trader", agents: ["trader"] },
  { id: "p2", label: "Phase 2 — Research Debate", agents: ["bullResearcher", "bearResearcher", "researchManager"] },
  { id: "p1", label: "Phase 1 — Analysts", agents: ["fundamentalsAnalyst", "sentimentAnalyst", "newsAnalyst", "technicalAnalyst", "companyProfileAnalyst", "marketAnalyst", "macroAnalyst", "quantAnalyst", "disclosureAnalyst"] },
];

/** Resource storage keys for Phase 1 memos.
 *
 * - `memoKey` is the full storage key (e.g. `memos/p1/fundamentals`) for
 *   display, logging, and `useResourceCollection.get(...)`.
 * - `collectionKey` is the bare suffix (e.g. `p1/fundamentals`) passed to
 *   `collection.create(...)` / `collection.get(...)` — the framework
 *   auto-prepends the `memos/` prefix from the collection's pattern. */
export const PHASE_1_MEMO_KEYS = {
  fundamentals: {
    agentName: "fundamentalsAnalyst",
    memoKey: "memos/p1/fundamentals",
    collectionKey: "p1/fundamentals",
  },
  sentiment: {
    agentName: "sentimentAnalyst",
    memoKey: "memos/p1/sentiment",
    collectionKey: "p1/sentiment",
  },
  news: {
    agentName: "newsAnalyst",
    memoKey: "memos/p1/news",
    collectionKey: "p1/news",
  },
  technical: {
    agentName: "technicalAnalyst",
    memoKey: "memos/p1/technical",
    collectionKey: "p1/technical",
  },
  companyProfile: {
    agentName: "companyProfileAnalyst",
    memoKey: "memos/p1/company-profile",
    collectionKey: "p1/company-profile",
  },
  market: {
    agentName: "marketAnalyst",
    memoKey: "memos/p1/market",
    collectionKey: "p1/market",
  },
  macro: {
    agentName: "macroAnalyst",
    memoKey: "memos/p1/macro",
    collectionKey: "p1/macro",
  },
  quant: {
    agentName: "quantAnalyst",
    memoKey: "memos/p1/quant",
    collectionKey: "p1/quant",
  },
  disclosure: {
    agentName: "disclosureAnalyst",
    memoKey: "memos/p1/disclosure",
    collectionKey: "p1/disclosure",
  },
} as const satisfies Record<
  string,
  { agentName: AgentName; memoKey: string; collectionKey: string }
>;

export type Phase1MemoShortName = keyof typeof PHASE_1_MEMO_KEYS;

/** Resource storage keys for Phase 2 memos (bull, bear, research manager).
 *  Same shape as `PHASE_1_MEMO_KEYS`. */
export const PHASE_2_MEMO_KEYS = {
  bull: {
    agentName: "bullResearcher",
    memoKey: "memos/p2/bull",
    collectionKey: "p2/bull",
  },
  bear: {
    agentName: "bearResearcher",
    memoKey: "memos/p2/bear",
    collectionKey: "p2/bear",
  },
  researchManager: {
    agentName: "researchManager",
    memoKey: "memos/p2/research-manager",
    collectionKey: "p2/research-manager",
  },
} as const satisfies Record<
  string,
  { agentName: AgentName; memoKey: string; collectionKey: string }
>;

export type Phase2MemoShortName = keyof typeof PHASE_2_MEMO_KEYS;

/** Resource storage keys for Phase 3 memos (trader). Same shape as the
 *  Phase 1 / 2 maps. */
export const PHASE_3_MEMO_KEYS = {
  trader: {
    agentName: "trader",
    memoKey: "memos/p3/trader",
    collectionKey: "p3/trader",
  },
} as const satisfies Record<
  string,
  { agentName: AgentName; memoKey: string; collectionKey: string }
>;

export type Phase3MemoShortName = keyof typeof PHASE_3_MEMO_KEYS;

/** Resource storage keys for Phase 4 memos: three persona critiques plus a
 *  consolidated risk assessment. Same shape as the Phase 1/2/3 maps. */
export const PHASE_4_MEMO_KEYS = {
  aggressive: {
    agentName: "aggressiveRisk",
    memoKey: "memos/p4/aggressive-risk",
    collectionKey: "p4/aggressive-risk",
  },
  conservative: {
    agentName: "conservativeRisk",
    memoKey: "memos/p4/conservative-risk",
    collectionKey: "p4/conservative-risk",
  },
  neutral: {
    agentName: "neutralRisk",
    memoKey: "memos/p4/neutral-risk",
    collectionKey: "p4/neutral-risk",
  },
  riskAssessment: {
    agentName: "riskAssessment",
    memoKey: "memos/p4/risk-assessment",
    collectionKey: "p4/risk-assessment",
  },
} as const satisfies Record<
  string,
  { agentName: AgentName; memoKey: string; collectionKey: string }
>;

export type Phase4MemoShortName = keyof typeof PHASE_4_MEMO_KEYS;

/** Resource storage keys for Phase 5 memos: scenario forecaster + portfolio
 *  manager. Same shape as the Phase 1/2/3/4 maps. */
export const PHASE_5_MEMO_KEYS = {
  scenarioForecast: {
    agentName: "scenarioForecaster",
    memoKey: "memos/p5/scenario-forecaster",
    collectionKey: "p5/scenario-forecaster",
  },
  portfolioManager: {
    agentName: "portfolioManager",
    memoKey: "memos/p5/portfolio-manager",
    collectionKey: "p5/portfolio-manager",
  },
} as const satisfies Record<
  string,
  { agentName: AgentName; memoKey: string; collectionKey: string }
>;

export type Phase5MemoShortName = keyof typeof PHASE_5_MEMO_KEYS;

/** Resource storage key for the Phase 6 thesis-alignment memo. Phase 6 is the
 *  post-decision audit of the user's thesis against the independent pipeline;
 *  it only runs when a `userThesis` was provided. Same shape as the Phase
 *  1/2/3/4/5 maps. */
export const PHASE_6_MEMO_KEYS = {
  thesisAlignment: {
    agentName: "thesisValidator",
    memoKey: "memos/p6/thesis-alignment",
    collectionKey: "p6/thesis-alignment",
  },
} as const satisfies Record<
  string,
  { agentName: AgentName; memoKey: string; collectionKey: string }
>;

export type Phase6MemoShortName = keyof typeof PHASE_6_MEMO_KEYS;

/** Combined memo-key map across all shipped phases. The sidebar iterates
 *  this single table; future phases append their own entries. */
export const ALL_MEMO_KEYS = {
  ...PHASE_1_MEMO_KEYS,
  ...PHASE_2_MEMO_KEYS,
  ...PHASE_3_MEMO_KEYS,
  ...PHASE_4_MEMO_KEYS,
  ...PHASE_5_MEMO_KEYS,
  ...PHASE_6_MEMO_KEYS,
} as const;

export type AnyMemoShortName = keyof typeof ALL_MEMO_KEYS;

/** Reverse lookup: which short name owns this agent across any phase? */
export function shortNameForAgent(
  agent: AgentName,
): AnyMemoShortName | undefined {
  for (const [shortName, mapping] of Object.entries(ALL_MEMO_KEYS) as Array<
    [AnyMemoShortName, (typeof ALL_MEMO_KEYS)[AnyMemoShortName]]
  >) {
    if (mapping.agentName === agent) return shortName;
  }
  return undefined;
}
