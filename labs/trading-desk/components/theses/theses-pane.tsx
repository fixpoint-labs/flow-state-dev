/**
 * ThesesPane — right pane: phase-grouped sidebar + memo doc area.
 *
 * The doc area dispatches on `(agentName, status)`:
 *   - `pending` → loud-badge "awaiting upstream phases" card.
 *   - `writing` → `WritingSkeleton`.
 *   - `published` AND `agentName === "portfolioManager"` → `PmHero` (P5).
 *   - `published` otherwise → `ThesisHeader` + `ThesisBody`.
 *   - `error` → red marker + error message.
 *
 * Live status (`memoStatus`) flows in from the parent via `useClientData`,
 * so the navigator and doc area both reflect mid-stream transitions. Body
 * content comes from `useResourceCollectionItem` keyed on the per-agent
 * memo's `collectionKey`.
 *
 * Auto-follow: when the user has not selected manually, selection tracks
 * the most-recently-published (or, failing that, currently-writing) memo.
 * `re-run` clears the manual-selection flag.
 *
 * Tab switch (Slice 3): a Theses | Summary toggle sits above the doc area.
 * Theses is the existing sidebar+doc experience; Summary renders the
 * `<ReportSummary>` at-a-glance aggregate over the SAME already-loaded session
 * state (zero re-run). A finished report auto-opens on Summary; a streaming run
 * stays on Theses for the live memo-follow. Selecting a sidebar entry switches
 * back to Theses.
 */
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { SessionView } from "@flow-state-dev/react";
import { useClientData, useResourceCollectionItem } from "@flow-state-dev/react";
import { MemoSidebar } from "./memo-sidebar";
import { AgentBadge } from "@/components/agent-badge";
import { ThesisHeader } from "./thesis-header";
import { ThesisBody } from "./thesis-body";
import { PmHero } from "./pm-hero";
import { LensCard } from "./lens-card";
import { ScenarioPanel } from "./scenario-panel";
import { WritingSkeleton } from "./writing-skeleton";
import { ReportSummary } from "@/components/summary/report-summary";
import {
  AGENTS,
  ALL_MEMO_KEYS,
  LENS_IDS,
  PHASE_2B_MEMO_KEYS,
  PHASE_5_MEMO_KEYS,
  shortNameForAgent,
  type AgentName,
  type AnyMemoShortName,
} from "@/src/flows/trading-desk/registry";
import type {
  MemoState,
  MemoStatus,
  ThesisSection,
} from "@/src/flows/trading-desk/resources";
import { cn } from "@/lib/utils";

type ThesesPaneProps = {
  session: SessionView;
  memoStatus: Partial<Record<AnyMemoShortName, MemoStatus>>;
};

/** The four phase-2b lens agents, derived READ-ONLY from the Slice-5
 *  `PHASE_2B_MEMO_KEYS` registry. A `published` memo for one of these agents
 *  renders as a dedicated `LensCard` rather than the generic memo doc. */
const LENS_AGENTS: ReadonlySet<AgentName> = new Set(
  LENS_IDS.map((id) => PHASE_2B_MEMO_KEYS[id].agentName),
);

/** Order memos are expected to publish in. Auto-follow walks back-to-front. */
const PUBLISH_ORDER: ReadonlyArray<AnyMemoShortName> = [
  "fundamentals",
  "sentiment",
  "news",
  "technical",
  "companyProfile",
  "market",
  "macro",
  "quant",
  "disclosure",
  "bull",
  "bear",
  "researchManager",
  "trader",
  "aggressive",
  "conservative",
  "neutral",
  "riskAssessment",
  "scenarioForecast",
  "portfolioManager",
  "thesisAlignment",
];

export function ThesesPane({
  session,
  memoStatus,
}: ThesesPaneProps): ReactElement {
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);
  const userSelectedRef = useRef(false);
  const [tab, setTab] = useState<"theses" | "summary">("theses");
  const userPickedTabRef = useRef(false);

  // Authoritative completion flag, read from the exposed session state. Stable
  // across a transient stream re-attach (opening a stored report can briefly
  // report isStreaming with 0 items) — unlike isStreaming/items, which flicker.
  // A finished report (PM committed, or a stop guard tripped) has
  // runComplete === true; a fresh or re-running session has it false.
  const { session: live } = useClientData(session, { session: ["runComplete"] });
  const runComplete = live?.runComplete === true;

  // Reset manual-selection flags only on a genuine re-run — a run STARTING
  // (streaming, 0 items) on a session that is NOT already complete. The
  // `!runComplete` guard stops a finished report from snapping back to Theses
  // when its stream merely re-attaches on open. Effect: synchronizes refs with
  // the run-lifecycle signal.
  useEffect(() => {
    if (session.isStreaming && session.items.length === 0 && !runComplete) {
      userSelectedRef.current = false;
      setSelectedAgent(null);
      userPickedTabRef.current = false;
      setTab("theses");
    }
  }, [session.isStreaming, session.items.length, runComplete]);

  // Auto-tab: when the user hasn't picked a tab manually, a FINISHED report
  // (runComplete — the stable signal, with a not-streaming-with-items fallback)
  // opens on Summary; an in-progress/streaming run stays on Theses for the live
  // memo-follow. Mirrors userPickedTabRef so a manual choice sticks.
  const finished =
    runComplete || (!session.isStreaming && session.items.length > 0);
  useEffect(() => {
    if (userPickedTabRef.current) return;
    setTab(finished ? "summary" : "theses");
  }, [finished]);

  // Auto-follow selection if the user hasn't manually picked.
  useEffect(() => {
    if (userSelectedRef.current) return;
    const lastPublished = [...PUBLISH_ORDER]
      .reverse()
      .find((s) => memoStatus[s] === "published");
    const writing = PUBLISH_ORDER.find((s) => memoStatus[s] === "writing");
    const target =
      (lastPublished !== undefined ? ALL_MEMO_KEYS[lastPublished].agentName : undefined) ??
      (writing !== undefined ? ALL_MEMO_KEYS[writing].agentName : undefined);
    if (target !== undefined) {
      setSelectedAgent(target as AgentName);
    }
  }, [memoStatus]);

  // Selecting a sidebar entry always returns to the Theses tab (the memo lives
  // there) and counts as a manual tab choice so the auto-rule won't override it.
  const handleSelectAgent = (agent: AgentName) => {
    userSelectedRef.current = true;
    setSelectedAgent(agent);
    userPickedTabRef.current = true;
    setTab("theses");
  };

  const handlePickTab = (next: "theses" | "summary") => {
    userPickedTabRef.current = true;
    setTab(next);
  };

  return (
    <section
      className="flex overflow-hidden bg-[color:var(--c-bg)]"
      aria-label="Theses"
    >
      <MemoSidebar
        memoStatus={memoStatus}
        selectedAgent={selectedAgent}
        onSelectAgent={handleSelectAgent}
      />
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        <TabSwitch tab={tab} onPick={handlePickTab} />
        {tab === "summary" ? (
          <ReportSummary session={session} />
        ) : selectedAgent === null ? (
          <EmptySelection />
        ) : (
          <MemoDoc
            session={session}
            agent={selectedAgent}
            status={statusForAgent(selectedAgent, memoStatus)}
          />
        )}
      </div>
    </section>
  );
}

function TabSwitch({
  tab,
  onPick,
}: {
  tab: "theses" | "summary";
  onPick: (next: "theses" | "summary") => void;
}): ReactElement {
  return (
    <div
      className="mb-4 flex gap-1"
      role="tablist"
      aria-label="Report view"
    >
      {(["theses", "summary"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          onClick={() => onPick(value)}
          className={cn(
            "rounded-md px-3 py-1 font-mono text-[10.5px] uppercase tracking-wider transition-colors",
            tab === value
              ? "bg-[color:var(--c-surface-2)] text-[color:var(--c-fg)]"
              : "text-[color:var(--c-fg-faint)] hover:bg-[color:var(--c-surface)]",
          )}
        >
          {value === "theses" ? "Theses" : "Summary"}
        </button>
      ))}
    </div>
  );
}

function statusForAgent(
  agent: AgentName,
  memoStatus: Partial<Record<AnyMemoShortName, MemoStatus>>,
): MemoStatus | "unavailable" {
  const shortName = shortNameForAgent(agent);
  if (shortName === undefined) return "unavailable";
  return memoStatus[shortName] ?? "pending";
}

function EmptySelection(): ReactElement {
  return (
    <p className="m-auto max-w-md text-center text-[12px] leading-relaxed text-[color:var(--c-fg-faint)]">
      Click New Analysis to start a run, or pick a phase entry on the left to
      see its memo. Each entry becomes live once its agent runs.
    </p>
  );
}

type MemoDocProps = {
  session: SessionView;
  agent: AgentName;
  status: MemoStatus | "unavailable";
};

// Derived from the canonical `memoStateSchema` so the client-data type
// can't drift from the resource contract (FIX-564 reviewer feedback).
type AcceptedAdjustment = NonNullable<
  MemoState["acceptedAdjustments"]
>["sizing"];
// Slice 5 — portfolio-fit + lens-convergence shapes, derived from the canonical
// schema so the client-data type can't drift.
type PortfolioFit = NonNullable<MemoState["portfolioFit"]>;
type LensConvergence = NonNullable<MemoState["lensConvergence"]>;

type MemoClientData = {
  status: MemoStatus;
  label: string | null;
  headline: string | null;
  rating: string | null;
  body: ThesisSection[] | null;
  metrics: Record<string, string> | null;
  citations: Array<{ url: string; title: string }> | null;
  errorMessage: string | null;
  // Lens fields (Slice 5) — populated on `memos/p2b/<lensId>` lens memos; the
  // 3-tier stance + self-reported conviction the LensCard (Slice 7) reads back.
  stance: "bullish" | "neutral" | "bearish" | null;
  conviction: number | null;
  // Phase 5 extension fields — only populated on `memos/p5/scenario-forecaster`.
  scenarios: Array<{
    name: string;
    probability: number;
    trigger: string;
    triggerSource: string;
    expectedOutcome: string;
    tradeBehavior: string;
  }> | null;
  distribution: "concentrated" | "balanced" | "barbell" | "long-tail" | null;
  evidenceBasis: "sufficient" | "thin" | null;
  horizon: string | null;
  // Phase 5 extension fields — only populated on `memos/p5/portfolio-manager`.
  decisionSummary: string | null;
  finalRating:
    | "Sell"
    | "Underweight"
    | "Hold"
    | "Overweight"
    | "Buy"
    | null;
  decisionConfidence: number | null;
  acceptedAdjustments:
    | {
        sizing: AcceptedAdjustment;
        holdingPeriod: AcceptedAdjustment;
        invalidation: AcceptedAdjustment;
      }
    | null;
  keyDependencies: string[] | null;
  upstreamReferences:
    | {
        analystMemos: string[];
        thesis: string;
        tradeProposal: string;
        riskAssessment: string;
      }
    | null;
  agreesWithTrader: boolean | null;
  primaryScenario: string | null;
  // Slice 5 — only populated on `memos/p5/portfolio-manager`.
  portfolioFit: PortfolioFit | null;
  lensConvergence: LensConvergence | null;
};

function MemoDoc({ session, agent, status }: MemoDocProps): ReactElement {
  const shortName = shortNameForAgent(agent);
  const collectionKey =
    shortName !== undefined ? ALL_MEMO_KEYS[shortName].collectionKey : undefined;

  // The memos collection always exists at the flow level; only call the
  // hook for known phase-1 short names. PMHero / Phase 2+ memos go through
  // their own resource lookup in later phases.
  const { item } = useResourceCollectionItem(
    session,
    "memos",
    collectionKey ?? "p1/fundamentals",
  );
  const data = useMemo<MemoClientData | null>(() => {
    if (collectionKey === undefined) return null;
    if (item === null) return null;
    return (item.clientData ?? null) as MemoClientData | null;
  }, [item, collectionKey]);

  if (status === "unavailable" || status === "pending") {
    return <PendingDoc agent={agent} />;
  }

  if (status === "writing") {
    return <WritingSkeleton agent={agent} />;
  }

  if (status === "error") {
    return (
      <div
        className={cn(
          "flex flex-col gap-2 rounded-md border p-4",
          "border-[color:var(--c-warn)]/40 bg-[color:var(--c-warn)]/10",
        )}
      >
        <div className="flex items-center gap-2">
          <AgentBadge agent={agent} treatment="medium" />
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-warn)]">
            error
          </span>
        </div>
        <p className="text-[12.5px] text-[color:var(--c-fg)]">
          {data?.errorMessage ?? "Analyst run failed."}
        </p>
      </div>
    );
  }

  // status === "published"
  if (agent === "scenarioForecaster") {
    return (
      <ScenarioPanel
        agent={agent}
        label={data?.label ?? null}
        headline={data?.headline ?? null}
        rating={data?.rating ?? null}
        body={data?.body ?? null}
        metrics={data?.metrics ?? null}
        scenarios={data?.scenarios ?? null}
        distribution={data?.distribution ?? null}
        evidenceBasis={data?.evidenceBasis ?? null}
        horizon={data?.horizon ?? null}
      />
    );
  }

  if (agent === "portfolioManager") {
    return (
      <PmHeroWithScenarios session={session} data={data} agent={agent} />
    );
  }

  // Slice 7 — a published lens memo renders as a dedicated LensCard (glyph +
  // attribution framing, stance/conviction, the data-gap honesty line, and the
  // structural-bear affordance) instead of the generic ThesisHeader+ThesisBody.
  if (LENS_AGENTS.has(agent)) {
    return <LensCard agent={agent} data={data} />;
  }

  return (
    <article className="flex flex-col gap-5">
      <ThesisHeader
        agent={agent}
        label={data?.label ?? null}
        headline={data?.headline ?? null}
        rating={data?.rating ?? null}
        metrics={data?.metrics ?? null}
      />
      {data?.body !== null && data?.body !== undefined && data.body.length > 0 && (
        <ThesisBody body={data.body} citations={data.citations ?? null} />
      )}
      <p className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        end of memo · {data?.label ?? AGENTS[agent]?.role ?? ""} · {agent}
      </p>
    </article>
  );
}

function PmHeroWithScenarios({
  session,
  data,
  agent,
}: {
  session: SessionView;
  data: MemoClientData | null;
  agent: AgentName;
}): ReactElement {
  const { item: scenarioItem } = useResourceCollectionItem(
    session,
    "memos",
    PHASE_5_MEMO_KEYS.scenarioForecast.collectionKey,
  );
  const scenarioStrip = useMemo(() => {
    if (scenarioItem === null) return null;
    const sd = scenarioItem.clientData as MemoClientData | null;
    if (sd === null || sd.scenarios === null || sd.scenarios.length === 0) return null;
    return {
      scenarios: sd.scenarios.map((s) => ({ name: s.name, probability: s.probability })),
      distribution: sd.distribution ?? "balanced",
      primaryScenario: data?.primaryScenario ?? null,
    };
  }, [scenarioItem, data]);

  return (
    <PmHero
      agent={agent}
      label={data?.label ?? null}
      headline={data?.headline ?? null}
      rating={data?.rating ?? null}
      body={data?.body ?? null}
      metrics={data?.metrics ?? null}
      decisionSummary={data?.decisionSummary ?? null}
      finalRating={data?.finalRating ?? null}
      decisionConfidence={data?.decisionConfidence ?? null}
      acceptedAdjustments={data?.acceptedAdjustments ?? null}
      keyDependencies={data?.keyDependencies ?? null}
      upstreamReferences={data?.upstreamReferences ?? null}
      agreesWithTrader={data?.agreesWithTrader ?? null}
      scenarioStrip={scenarioStrip}
      portfolioFit={data?.portfolioFit ?? null}
      lensConvergence={data?.lensConvergence ?? null}
      snapshotAsOf={data?.portfolioFit?.snapshotAsOf ?? null}
    />
  );
}

function PendingDoc({ agent }: { agent: AgentName }): ReactElement {
  const meta = AGENTS[agent];
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg p-5",
        "border border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
    >
      <div className="flex items-center gap-2.5">
        <AgentBadge agent={agent} treatment="loud" />
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-[color:var(--c-fg)]">
            {meta?.role ?? agent}
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            awaiting upstream phases
          </span>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-[color:var(--c-fg-muted)]">
        This memo will populate once the upstream phases finish their work.
      </p>
    </div>
  );
}
