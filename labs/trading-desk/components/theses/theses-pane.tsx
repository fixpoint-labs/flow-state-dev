/**
 * ThesesPane — right pane: phase-grouped sidebar + memo doc area.
 *
 * The doc area dispatches on `(agentName, status)`:
 *   - `pending` → loud-badge "awaiting upstream phases" card.
 *   - `writing` → `WritingSkeleton`.
 *   - `published` AND `agentName === "portfolioManager"` → `PmHero` (P5).
 *   - `published` AND a phase-2b lens agent → `LensCard`.
 *   - `published` AND `agentName === "trader"` → `TraderProposalCard` (P3).
 *   - `published` AND a phase-4 risk agent → `RiskCritiqueCard` (P4).
 *   - `published` otherwise → `ThesisHeader` + `ThesisBody`.
 *   - `error` → red marker + error message.
 *
 * The three dedicated-renderer arms route off the registry-derived sets in
 * `memo-renderer-routing.ts`, never a hand-maintained list.
 *
 * Live status is derived from the memos collection itself: the collection
 * opts into `client: { live: true }` (FIX-739), so `useResourceCollectionList`
 * surfaces each memo's `status` mid-stream with no refetch, and the navigator
 * and doc area both reflect transitions straight from the resource — no
 * `memoStatus` session mirror. Body content comes from
 * `useResourceCollectionItem` keyed on the per-agent memo's `collectionKey`.
 *
 * Auto-follow: when the user has not selected manually, selection tracks
 * the most-recently-published (or, failing that, currently-writing) memo.
 * `re-run` clears the manual-selection flag.
 *
 * Jump to transcript (FIX-1062): a published memo header offers a control that
 * scrolls the transcript pane to that agent's originating event. The pane owns
 * only the "is there a target" half — `agentsWithTranscriptRows` over the same
 * projection the transcript pane renders from — and delegates the navigation
 * itself to `onJumpToTranscript`, because on mobile the transcript surface is
 * unmounted until `app/page.tsx` switches tabs. No target and no handler mean
 * no control, so the header can never carry a clickable no-op.
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
import { PanelLeft } from "lucide-react";
import type { SessionView } from "@flow-state-dev/react";
import {
  useClientData,
  useResourceCollectionItem,
  useResourceCollectionList,
} from "@flow-state-dev/react";
import { MemoSidebar } from "./memo-sidebar";
import { AgentBadge } from "@/components/agent-badge";
import { ThesisHeader } from "./thesis-header";
import { ThesisBody } from "./thesis-body";
import { PmHero } from "./pm-hero";
import { ReportThesisPanel } from "./report-thesis-panel";
import { LensCard } from "./lens-card";
import { TraderProposalCard } from "./trader-proposal-card";
import { RiskCritiqueCard } from "./risk-critique-card";
import {
  LENS_AGENTS,
  RISK_AGENTS,
  TRADER_AGENTS,
} from "./memo-renderer-routing";
import { ScenarioPanel } from "./scenario-panel";
import { WritingSkeleton } from "./writing-skeleton";
import { ReportSummary } from "@/components/summary/report-summary";
import { ReportProvenanceBanner } from "@/components/summary/report-provenance-notice";
import { agentsWithTranscriptRows } from "@/components/transcript/transcript-rows";
import {
  AGENTS,
  ALL_MEMO_KEYS,
  COLLECTION_KEY_TO_SHORT,
  PHASE_3_MEMO_KEYS,
  PHASE_5_MEMO_KEYS,
  shortNameForAgent,
  type AgentName,
  type AnyMemoShortName,
} from "@/flows/analysis/registry";
import type { MemoStatus } from "@/flows/analysis/resources";
import { memosCollection } from "@/flows/analysis/resources";
import {
  buildTradeLevelModel,
  storedTradeLevelsFrom,
} from "@/flows/analysis/lib/trade-levels";
import type { ClientDataOf } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";

type ThesesPaneProps = {
  session: SessionView;
  /** Reveal the transcript surface (mobile) and scroll it to `agent`'s first
   *  event. Omitted where no transcript surface is reachable — the memo header
   *  then shows no jump control. */
  onJumpToTranscript?: (agent: AgentName) => void;
};

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
  onJumpToTranscript,
}: ThesesPaneProps): ReactElement {
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);
  const userSelectedRef = useRef(false);
  const [tab, setTab] = useState<"theses" | "summary">("theses");
  const userPickedTabRef = useRef(false);
  // Below `lg` the memo navigator opens as a slide-in drawer (FIX-757); the
  // inline 200px sidebar would eat half a phone's width.
  const [navOpen, setNavOpen] = useState(false);
  const navDialogRef = useRef<HTMLDialogElement>(null);

  // Drive the drawer's native <dialog> imperatively from `navOpen` — the same
  // idiom as SettingsDialog, so ESC/focus-trap/backdrop come from the browser.
  useEffect(() => {
    const dialog = navDialogRef.current;
    if (!dialog) return;
    if (navOpen && !dialog.open) dialog.showModal();
    if (!navOpen && dialog.open) dialog.close();
  }, [navOpen]);

  // Close the drawer if the viewport crosses up past `lg` while it is open.
  // A modal dialog keeps the rest of the document inert from the top layer
  // even when `lg:hidden` visually hides it, which would leave the desktop
  // shell unreachable after a resize. Effect, not derived state: it syncs
  // with an external system (the viewport media query).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setNavOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Authoritative completion flag, read from the exposed session state. Stable
  // across a transient stream re-attach (opening a stored report can briefly
  // report isStreaming with 0 items) — unlike isStreaming/items, which flicker.
  // A finished report (PM committed, or a stop guard tripped) has
  // runComplete === true; a fresh or re-running session has it false.
  const { session: live } = useClientData(session, { session: ["runComplete"] });
  const runComplete = live?.runComplete === true;

  // Per-agent live status, derived from the memos collection. The collection
  // is `client: { live: true }`, so `useResourceCollectionList` reflects each
  // memo's `status` mid-stream (FIX-739) with no session-state mirror. A memo
  // not yet created is absent → `statusForAgent` defaults it to `pending`.
  // Derived state → useMemo, not an effect (BP-010).
  // Cap tracks the registry so adding a phase can never silently truncate the
  // status map (a dropped memo would render permanently `pending`).
  const { items: memoItems } = useResourceCollectionList(session, "memos", {
    limit: Object.keys(ALL_MEMO_KEYS).length,
  });
  const memoStatus = useMemo<Partial<Record<AnyMemoShortName, MemoStatus>>>(() => {
    const map: Partial<Record<AnyMemoShortName, MemoStatus>> = {};
    for (const item of memoItems) {
      const short = COLLECTION_KEY_TO_SHORT[item.topic];
      if (short === undefined) continue;
      const status = (item.clientData as { status?: MemoStatus } | null)?.status;
      if (status !== undefined) map[short] = status;
    }
    return map;
  }, [memoItems]);

  // Which agents actually have a transcript event to jump to. Derived from the
  // SAME projection the transcript pane renders (BP-010: derived state via
  // useMemo, not an effect), so the control is offered only where the jump
  // will land. A re-opened report whose items were never persisted yields an
  // empty set and no memo shows the control.
  const jumpableAgents = useMemo(
    () => agentsWithTranscriptRows(session.items as OutputItem[]),
    [session.items],
  );

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
        className="hidden lg:block"
        memoStatus={memoStatus}
        selectedAgent={selectedAgent}
        onSelectAgent={handleSelectAgent}
      />
      {/* Below lg the navigator opens as a native <dialog> drawer — the same
          imperative open/close idiom as the app's other dialogs, so the focus
          trap, ESC-to-close, and the backdrop come from the browser (a bare
          role="dialog" div provides none of those for keyboard users). A
          backdrop click lands on the dialog element itself (the sidebar fills
          it), which is the standard dismiss test. */}
      <dialog
        ref={navDialogRef}
        onClose={() => setNavOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        aria-label="Theses navigator"
        className={cn(
          "td-drawer m-0 h-full max-h-none w-[260px] max-w-[85vw] border-0 p-0",
          "bg-transparent shadow-2xl backdrop:bg-black/40 lg:hidden",
        )}
      >
        <MemoSidebar
          className="h-full w-full"
          memoStatus={memoStatus}
          selectedAgent={selectedAgent}
          onSelectAgent={(agent) => {
            setNavOpen(false);
            handleSelectAgent(agent);
          }}
        />
      </dialog>
      <div className="flex flex-1 flex-col overflow-y-auto p-6 max-lg:p-4">
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 lg:hidden",
              "border-[color:var(--c-border)] text-[color:var(--c-fg-muted)]",
              "font-mono text-[10.5px] uppercase tracking-wider",
            )}
          >
            <PanelLeft className="h-3.5 w-3.5" aria-hidden />
            Phases
          </button>
          <TabSwitch tab={tab} onPick={handlePickTab} />
        </div>
        {/* ABOVE the Theses/Summary conditional, so the disclosure is gated
            only on the report being pre-fix. Inside the Summary branch it was
            invisible to a reader whose sticky tab choice kept them on Theses —
            precisely the readers looking at memos built on fabricated zeros. */}
        <div className="mb-4 empty:mb-0">
          <ReportProvenanceBanner session={session} />
        </div>
        {tab === "summary" ? (
          <ReportSummary session={session} />
        ) : selectedAgent === null ? (
          <EmptySelection />
        ) : (
          <MemoDoc
            session={session}
            agent={selectedAgent}
            status={statusForAgent(selectedAgent, memoStatus)}
            onJumpToTranscript={
              onJumpToTranscript !== undefined &&
              jumpableAgents.has(selectedAgent)
                ? () => onJumpToTranscript(selectedAgent)
                : null
            }
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
    <div className="flex gap-1" role="tablist" aria-label="Report view">
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
  /** Null when this memo has no transcript event to jump to. */
  onJumpToTranscript: (() => void) | null;
};

// FIX-741: the client-data type is derived from the memos collection's
// projection (identity → full MemoState) via `ClientDataOf`, so it can't drift
// from the resource contract. Replaces the previously hand-mirrored type; a
// projection/consumer mismatch is now a compile error.
type MemoClientData = ClientDataOf<typeof memosCollection>;

function MemoDoc({
  session,
  agent,
  status,
  onJumpToTranscript,
}: MemoDocProps): ReactElement {
  const shortName = shortNameForAgent(agent);
  const collectionKey =
    shortName !== undefined ? ALL_MEMO_KEYS[shortName].collectionKey : undefined;

  // The memos collection always exists at the flow level; only call the
  // hook for known phase-1 short names. PMHero / Phase 2+ memos go through
  // their own resource lookup in later phases.
  const { item } = useResourceCollectionItem<MemoClientData>(
    session,
    "memos",
    collectionKey ?? "p1/fundamentals",
  );
  const data = useMemo<MemoClientData | null>(() => {
    if (collectionKey === undefined) return null;
    if (item === null) return null;
    return item.clientData ?? null;
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

  // FIX-1061 — the trader and the four risk memos carry structured fields the
  // generic renderer never drew. Both cards take `onJumpToTranscript`: it is
  // the only navigation affordance a memo header has, and re-routing five memos
  // would silently delete it.
  if (TRADER_AGENTS.has(agent)) {
    return (
      <TraderProposalCard
        agent={agent}
        data={data}
        onJumpToTranscript={onJumpToTranscript}
      />
    );
  }

  if (RISK_AGENTS.has(agent)) {
    return (
      <RiskCritiqueCard
        agent={agent}
        data={data}
        onJumpToTranscript={onJumpToTranscript}
      />
    );
  }

  return (
    <article className="flex flex-col gap-5">
      <ThesisHeader
        agent={agent}
        label={data?.label ?? null}
        headline={data?.headline ?? null}
        rating={data?.rating ?? null}
        metrics={data?.metrics ?? null}
        onJumpToTranscript={onJumpToTranscript}
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
  const { item: scenarioItem } = useResourceCollectionItem<MemoClientData>(
    session,
    "memos",
    PHASE_5_MEMO_KEYS.scenarioForecast.collectionKey,
  );

  // FIX-780 — the hero's level chips are named from the TRADER's stance and
  // typed levels, not from the PM's stored `metrics` keys. On a report reopened
  // after the fact there is no commit to correct them, and a pre-fix PM record
  // carries `stop` / `target` whatever the desk actually decided — so reading the
  // stored keys showed a stop-loss on a stand-aside call. Same collection, same
  // hook as the scenario memo above.
  const { item: traderItem } = useResourceCollectionItem<MemoClientData>(
    session,
    "memos",
    PHASE_3_MEMO_KEYS.trader.collectionKey,
  );
  const levels = useMemo(() => {
    const td = traderItem?.clientData ?? null;
    if (td === null) return null;
    return buildTradeLevelModel(storedTradeLevelsFrom(td));
  }, [traderItem]);
  const scenarioStrip = useMemo(() => {
    if (scenarioItem === null) return null;
    const sd = scenarioItem.clientData ?? null;
    if (sd === null || sd.scenarios === null || sd.scenarios.length === 0) return null;
    return {
      scenarios: sd.scenarios.map((s) => ({ name: s.name, probability: s.probability })),
      distribution: sd.distribution ?? "balanced",
      primaryScenario: data?.primaryScenario ?? null,
    };
  }, [scenarioItem, data]);

  // Pass the REAL completion signal (not a hard-coded true): `runComplete` flips
  // only after the PM commit writes the decision snapshot, so the adopt button
  // never offers an action that would fail with `no-decision` (e.g. the Summary
  // tab opened manually mid-run). The thesis panel sits above the hero.
  const { session: live } = useClientData(session, { session: ["runComplete"] });
  const runComplete = live?.runComplete === true;
  return (
    <div className="flex flex-col gap-5">
      <ReportThesisPanel
        session={session}
        ticker={data?.ticker ?? null}
        runComplete={runComplete}
      />
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
      mandateDecision={data?.mandateDecision ?? null}
      policyDecision={data?.policyDecision ?? null}
      evidenceDecision={data?.evidenceDecision ?? null}
      levels={levels}
      ratingUnanchored={data?.ratingUnanchored ?? null}
      periodDisclosure={data?.periodDisclosure ?? null}
      />
    </div>
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
