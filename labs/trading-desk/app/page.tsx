"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { createSessionClient, type SessionSummary } from "@flow-state-dev/client";
import {
  FlowProvider,
  useFlow,
  useSession,
  useClientData,
  useResource,
  useResourceCollectionItem,
  useResourceCollectionList,
} from "@flow-state-dev/react";
import {
  TopBar,
  type CostPreset,
  type DataSourceMode,
  type TradingDeskView,
} from "@/components/topbar";
import { StatusBar } from "@/components/status-bar";
import { SettingsDialog } from "@/components/settings-dialog";
import { NewAnalysisDialog } from "@/components/new-analysis-dialog";
import { TranscriptPane } from "@/components/transcript/transcript-pane";
import { ThesesPane } from "@/components/theses/theses-pane";
import { PastReportsPane } from "@/components/reports/past-reports-pane";
import { PortfolioPane } from "@/components/portfolio/portfolio-pane";
import { parseReportRow, reportRowTuple } from "@/src/flows/trading-desk/report-index";
import { buildAnalyzeInput } from "@/src/flows/trading-desk/analyze-input";
import { buildPortfolioContext } from "@/src/flows/trading-desk/portfolio/build-portfolio-context";
import type { AccountState } from "@/src/flows/trading-desk/portfolio/portfolio-schema";
import type { PortfolioQuotesState } from "@/src/flows/trading-desk/portfolio/portfolio-quotes-resource";
import type { PortfolioContextInput } from "@/src/flows/trading-desk/flow-schema";
import type { MemoStatus } from "@/src/flows/trading-desk/resources";
import type { AnyMemoShortName } from "@/src/flows/trading-desk/registry";
import {
  EMPTY_INSTRUCTIONS,
  type SpecialInstructionsState,
} from "@/src/flows/trading-desk/special-instructions";

const DEFAULT_TICKER = "NVDA";
const FLOW_KIND = "trading-desk";
const USER_ID = "devuser";

/** The four user-visible inputs that identify one analysis run. Sessions are
 *  keyed by `===` match across all four fields on `session.metadata`. */
type AnalyzeTuple = {
  ticker: string;
  date: string;
  costPreset: CostPreset;
  dataSource: DataSourceMode;
};

/** Format today as YYYY-MM-DD. Evaluated per-render so the default stays
 *  fresh across the lifetime of a long-running Next.js server. */
function todayIsoDate(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

/** Find an existing session whose `metadata` matches the tuple on all four
 *  fields. Strict equality — legacy sessions with partial metadata never
 *  match. */
function findSessionForTuple(
  sessions: ReadonlyArray<SessionSummary>,
  tuple: AnalyzeTuple,
): string | undefined {
  return sessions.find((s) => {
    const md = s.metadata;
    return (
      md?.ticker === tuple.ticker &&
      md?.date === tuple.date &&
      md?.costPreset === tuple.costPreset &&
      md?.dataSource === tuple.dataSource
    );
  })?.id;
}

/** Auto-derived session title using the middle dot (U+00B7) separator.
 *  Surfaces all four input fields in the session list at a glance. */
function titleForTuple(t: AnalyzeTuple): string {
  return `${t.ticker} · ${t.date} · ${t.costPreset} · ${t.dataSource}`;
}

export default function Page(): ReactElement {
  return (
    <FlowProvider flowKind={FLOW_KIND} userId={USER_ID} baseUrl="">
      <TradingDeskApp />
    </FlowProvider>
  );
}

function TradingDeskApp(): ReactElement {
  // Resolve-or-create runs explicitly inside `handleRun`. Auto-create would
  // race with the lookup and silently create an unkeyed session on first mount.
  // `autoSelectSession: false` keeps the hook from loading the most-recent
  // session on mount — selection is driven entirely off the input tuple below,
  // so a tuple with no matching session shows a blank screen (the thesis form)
  // rather than flashing it and then snapping to the latest run.
  const flow = useFlow({ autoCreateSession: false, autoSelectSession: false });
  const session = useSession(flow.activeSessionId);

  // The settings dialog reads the user-scoped instructions resource via
  // `useResource`, which projects from a session snapshot. Use the active
  // session when one is bound; otherwise fall back to whatever session is
  // first in `flow.sessions`. When no sessions exist, the gear is disabled.
  const readSessionId =
    flow.activeSessionId ?? flow.sessions[0]?.id ?? undefined;
  const readSession = useSession(readSessionId);
  const { clientData: instructionsClientData } = useResource(
    readSession,
    "specialInstructions",
  );
  const instructions =
    (instructionsClientData as SpecialInstructionsState | null) ??
    EMPTY_INSTRUCTIONS;

  // Portfolio snapshot for portfolio-aware analysis (Slice 5). Read the Slice-4
  // accounts (holdings inline) + the live `portfolioQuotes` from the bound read
  // session, and build the dispatch snapshot CLIENT-SIDE: the flow never
  // recomputes weights, and a missing live price degrades to null (never
  // fabricated — see `buildPortfolioContext`). Null when the user has no
  // accounts → the run is portfolio-blind exactly as today.
  // 50 is a generous ceiling for a demo. A real portfolio above this would
  // produce a SILENTLY incomplete snapshot — missing accounts/holdings/cash, so
  // the PM reasons from an under-counted NAV with no signal. Acceptable for the
  // example; raise or paginate (and surface the truncation) before real use.
  const accountsList = useResourceCollectionList(readSession, "accounts", {
    limit: 50,
  });
  const { clientData: quotesClientData } = useResource(readSession, "portfolioQuotes");
  const portfolioSnapshot = useMemo<PortfolioContextInput | null>(() => {
    const accounts = accountsList.items
      .map((it) => it.clientData as AccountState | undefined)
      .filter((a): a is AccountState => a !== undefined);
    const quotes = quotesClientData as PortfolioQuotesState | null;
    return buildPortfolioContext(
      accounts,
      quotes?.quotes ?? [],
      quotes?.fetchedAt ?? null,
    );
  }, [accountsList.items, quotesClientData]);
  const activeInstructionCount = Object.values(instructions).filter(
    (v) => typeof v === "string" && v.trim().length > 0,
  ).length;
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [newAnalysisOpen, setNewAnalysisOpen] = useState(false);

  // Direct session client for create-with-title. `flow.createSession` only
  // forwards `metadata`; persisted sessions need a `title` to be browsable.
  const sessionClient = useMemo(() => createSessionClient({ baseUrl: "" }), []);

  const [ticker, setTicker] = useState(DEFAULT_TICKER);
  // Lazy initializer so the date is captured at the first render of this
  // mount, not at module load. Avoids stale "today" in long-running servers.
  const [date, setDate] = useState(() => todayIsoDate());
  const [costPreset, setCostPreset] = useState<CostPreset>("fast");
  const [dataSource, setDataSource] = useState<DataSourceMode>("fixture");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  // In-page view switcher (spec 02 §6.1: in-page branch, not new routes). The
  // `view` enum reserves `"portfolio"` in the type (TradingDeskView) so the
  // Portfolio slice extends it without churn; only desk/reports render today.
  const [view, setView] = useState<TradingDeskView>("desk");
  // Optional per-run user thesis. Frozen into session state at `seedSession`
  // (server-side); editing here after a run starts doesn't touch the running
  // session. A non-null thesis gates the Phase 6 audit.
  const [userThesis, setUserThesis] = useState("");
  const [userThesisRationale, setUserThesisRationale] = useState("");

  // Pending dispatch: after `selectSession`/`createSession` updates
  // `activeSessionId`, the next render gives us a `useSession` bound to the
  // resolved id. The effect below fires `sendAction` once that render lands.
  const [pendingDispatch, setPendingDispatch] = useState<
    {
      sessionId: string;
      tuple: AnalyzeTuple;
      userThesis: string | null;
      userThesisRationale: string | null;
      portfolio: PortfolioContextInput | null;
    } | null
  >(null);

  // Theme toggle — write to <html data-theme> so the OKLCH variables flip.
  // Using a real DOM mutation rather than a class on a wrapper avoids a
  // hydration mismatch with the server-rendered <html data-theme="dark">.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  const { session: sessionClientData } = useClientData(session, {
    session: ["costPreset", "memoStatus", "userThesis", "userThesisWarning"],
  });
  const liveCostPreset =
    (sessionClientData?.costPreset as CostPreset | undefined) ?? costPreset;
  const memoStatus =
    (sessionClientData?.memoStatus as
      | Partial<Record<AnyMemoShortName, MemoStatus>>
      | undefined) ?? {};
  const liveUserThesis =
    (sessionClientData?.userThesis as string | null | undefined) ?? null;
  const liveUserThesisWarning =
    (sessionClientData?.userThesisWarning as string | null | undefined) ?? null;

  // Phase 6 thesis-alignment memo, read for the status-bar badge. The
  // `alignment` enum is surfaced once the audit publishes.
  const { item: thesisAlignmentItem } = useResourceCollectionItem(
    session,
    "memos",
    "p6/thesis-alignment",
  );
  const thesisAlignment =
    (thesisAlignmentItem?.clientData as { alignment?: string | null } | null)
      ?.alignment ?? null;

  // Status-bar badge: only shown when a thesis was provided for this run.
  // `pending` while in flight, the alignment verdict once published, and
  // `error` if the Phase 6 audit failed (so it doesn't read "pending" forever).
  const thesisBadge: string | undefined =
    liveUserThesis === null
      ? undefined
      : memoStatus.thesisAlignment === "published" && thesisAlignment !== null
        ? thesisAlignment
        : memoStatus.thesisAlignment === "error"
          ? "error"
          : "pending";

  // The current input tuple identifies which persisted session this view maps
  // to. Sessions are keyed by `===` match on all four fields.
  const tuple = useMemo<AnalyzeTuple>(
    () => ({ ticker, date, costPreset, dataSource }),
    [ticker, date, costPreset, dataSource],
  );
  const matchedSessionId = useMemo(
    () => findSessionForTuple(flow.sessions, tuple),
    [flow.sessions, tuple],
  );
  // True when the current inputs map to an existing run (drives the run
  // button label: "re-run" for an existing session, "Run" for a fresh one).
  const isExistingSession = matchedSessionId !== undefined;

  // Drive the active session off the input tuple: a matching session loads,
  // no match clears selection (blank screen → the thesis form). While a
  // dispatch handshake is mid-flight we leave selection alone so this doesn't
  // fight `handleRun`. Effect (not derived state): it syncs an external store
  // (the flow hook's active-session selection) with the input tuple.
  useEffect(() => {
    if (pendingDispatch !== null) return;
    if (flow.activeSessionId !== matchedSessionId) {
      flow.selectSession(matchedSessionId);
    }
  }, [matchedSessionId, pendingDispatch, flow.activeSessionId, flow.selectSession]);

  const handleRun = useCallback(async () => {
    let targetId = matchedSessionId;
    if (targetId === undefined) {
      try {
        const created = await sessionClient.createSession({
          flowKind: FLOW_KIND,
          userId: USER_ID,
          title: titleForTuple(tuple),
          metadata: tuple,
        });
        targetId = created.id;
        await flow.refreshSessions();
      } catch (err) {
        // Network failure or 4xx/5xx from the server. The example has no
        // toast surface; log and bail so the user can retry. UI stays idle
        // because we never set `pendingDispatch`.
        console.error("[trading-desk] failed to create session", err);
        return;
      }
    }

    if (flow.activeSessionId !== targetId) {
      flow.selectSession(targetId);
    }
    // Freeze the thesis at click time so later edits don't reach this run.
    // `buildAnalyzeInput` owns the empty→null rule shared with the test suite.
    const frozen = buildAnalyzeInput(tuple, userThesis, userThesisRationale);
    setPendingDispatch({
      sessionId: targetId,
      tuple,
      userThesis: frozen.userThesis,
      userThesisRationale: frozen.userThesisRationale,
      // Freeze the portfolio snapshot at click time too — later price refreshes
      // or account edits don't reach a run already in flight.
      portfolio: portfolioSnapshot,
    });
  }, [
    tuple,
    matchedSessionId,
    userThesis,
    userThesisRationale,
    portfolioSnapshot,
    flow,
    sessionClient,
  ]);

  // Open a stored report from the Past Reports list. THE #1 BUG (spec 02 §6.5):
  // the tuple-sync effect above re-selects `activeSessionId` to whatever
  // `findSessionForTuple(header tuple)` resolves to. If we selected the opened
  // session WITHOUT first aligning the header inputs to its tuple, that effect
  // would immediately snap selection back to the header's tuple (or clear it) —
  // and worse, a mismatched tuple could mis-key a later run. So: set all four
  // header inputs to the row's tuple FIRST (so `findSessionForTuple` resolves
  // to exactly this id and the sync effect is a no-op), THEN select the session,
  // THEN switch to the desk view. Re-opening loads the stored report with zero
  // model spend — no `sendAction`, no dispatch handshake.
  const handleOpenReport = useCallback(
    (id: string) => {
      const summary = flow.sessions.find((s) => s.id === id);
      if (summary !== undefined) {
        const t = reportRowTuple(parseReportRow(summary));
        if (t.ticker !== "—" && t.ticker.length > 0) setTicker(t.ticker);
        if (t.date.length > 0) setDate(t.date);
        if (t.costPreset === "fast" || t.costPreset === "full") {
          setCostPreset(t.costPreset);
        }
        if (t.dataSource === "fixture" || t.dataSource === "live") {
          setDataSource(t.dataSource);
        }
      }
      flow.selectSession(id);
      setView("desk");
    },
    [flow],
  );

  // Fires once `useSession` is bound to the resolved session id. Without
  // this, calling `session.sendAction` synchronously after `selectSession`
  // would dispatch against the previously-active session because the hook's
  // sendAction captures `sessionId` from the closing render.
  useEffect(() => {
    if (pendingDispatch === null) return;
    if (flow.activeSessionId !== pendingDispatch.sessionId) return;
    const { tuple, userThesis: ut, userThesisRationale: utr, portfolio } = pendingDispatch;
    setPendingDispatch(null);
    void session.sendAction("analyze", {
      ...tuple,
      userThesis: ut,
      userThesisRationale: utr,
      // Portfolio-aware analysis (Slice 5). Null → portfolio-blind run. v1 does
      // not select accounts in the UI, so `selectedAccountIds` is empty (the PM
      // suggests an account). `selectedAccountIds` does NOT join the session
      // keying tuple in v1 (it is a refinement, not a new report).
      portfolio,
      selectedAccountIds: [],
    });
  }, [pendingDispatch, flow.activeSessionId, session]);

  const runState: "idle" | "streaming" | "complete" | "error" =
    session.error !== null && session.error !== undefined
      ? "error"
      : session.isStreaming
        ? "streaming"
        : session.items.length > 0
          ? "complete"
          : "idle";

  return (
    <div
      className="grid h-screen w-screen overflow-hidden"
      style={{ gridTemplateRows: "44px 1fr 28px" }}
    >
      <TopBar
        onNewAnalysis={() => setNewAnalysisOpen(true)}
        view={view}
        onViewChange={setView}
        theme={theme}
        onThemeToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      {view === "reports" ? (
        <main className="flex flex-col overflow-hidden">
          <PastReportsPane
            sessions={flow.sessions}
            onOpenReport={handleOpenReport}
          />
        </main>
      ) : view === "portfolio" ? (
        <main className="flex flex-col overflow-hidden">
          {/* Portfolio reads user-scoped resources through a session snapshot.
              Reuse the same `readSession` fallback the settings dialog uses —
              the active session, else the first session. Prices are always live
              (real holdings), so the analysis fixture/live toggle is not passed. */}
          <PortfolioPane
            session={readSession}
            hasSession={readSessionId !== undefined}
          />
        </main>
      ) : (
        <main
          className="grid overflow-hidden"
          style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}
        >
          <ThesesPane session={session} memoStatus={memoStatus} />
          <TranscriptPane session={session} />
        </main>
      )}
      <StatusBar
        state={runState}
        eventCount={session.items.length}
        preset={liveCostPreset}
        thesis={thesisBadge}
        thesisWarning={liveUserThesisWarning ?? undefined}
        activeInstructionCount={activeInstructionCount}
        onOpenSettings={() => setInstructionsOpen(true)}
        settingsDisabled={readSessionId === undefined}
      />
      {readSessionId !== undefined ? (
        <SettingsDialog
          open={instructionsOpen}
          onClose={() => setInstructionsOpen(false)}
          session={readSession}
        />
      ) : null}
      <NewAnalysisDialog
        open={newAnalysisOpen}
        onClose={() => setNewAnalysisOpen(false)}
        ticker={ticker}
        date={date}
        costPreset={costPreset}
        dataSource={dataSource}
        onTickerChange={setTicker}
        onDateChange={setDate}
        onCostPresetChange={setCostPreset}
        onDataSourceChange={setDataSource}
        userThesis={userThesis}
        userThesisRationale={userThesisRationale}
        onUserThesisChange={setUserThesis}
        onUserThesisRationaleChange={setUserThesisRationale}
        onSubmit={() => {
          void handleRun();
        }}
        isRunning={session.isStreaming}
        isExistingSession={isExistingSession}
      />
    </div>
  );
}
