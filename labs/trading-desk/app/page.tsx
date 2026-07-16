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
} from "@flow-state-dev/react";
import {
  TopBar,
  type CostPreset,
  type DataSourceMode,
  type TradingDeskView,
} from "@/components/topbar";
import { StatusBar } from "@/components/status-bar";
import { BottomNav, type MobileTab } from "@/components/mobile/bottom-nav";
import { MobileHeader } from "@/components/mobile/mobile-header";
import { MobileStatusLine } from "@/components/mobile/mobile-status";
import { SettingsDialog } from "@/components/settings-dialog";
import { NewAnalysisDialog } from "@/components/new-analysis-dialog";
import { TranscriptPane } from "@/components/transcript/transcript-pane";
import { ThesesPane } from "@/components/theses/theses-pane";
import { PastReportsPane } from "@/components/reports/past-reports-pane";
import { PortfolioPane } from "@/components/portfolio/portfolio-pane";
import { parseReportRow, reportRowTuple } from "@/flows/analysis/report-index";
import { buildAnalyzeInput } from "@/flows/analysis/analyze-input";
import type { RiskMandateId } from "@/flows/analysis/lib/risk-mandate";
import type { MemoStatus } from "@/flows/analysis/resources";
import {
  EMPTY_INSTRUCTIONS,
  type SpecialInstructionsState,
} from "@/flows/analysis/special-instructions";

const DEFAULT_TICKER = "NVDA";
const FLOW_KIND = "analysis";
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
 *  fields (ticker / date / costPreset / dataSource). Strict equality — legacy
 *  sessions with partial metadata never match. Each `dataSource` value
 *  (`fixture` / `live` / `record`) keys its own report, so a Live + Record run
 *  is a distinct session from a plain Live run of the same ticker/date/preset. */
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

/** Binds a portfolio-flow session and passes it to PortfolioPane.
 *  Rendered inside a <FlowProvider flowKind="portfolio">, so its
 *  useFlow + useSession calls dispatch to the portfolio flow. Sessions are
 *  incidental — accounts and quotes are user-scoped, so any session sees the
 *  same data. Auto-create/select so the pane is usable immediately. */
function PortfolioView(): ReactElement {
  const flow = useFlow({ autoCreateSession: true, autoSelectSession: true });
  const session = useSession(flow.activeSessionId);
  return (
    <PortfolioPane session={session} hasSession={flow.activeSessionId !== undefined} />
  );
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
  const [costPreset, setCostPreset] = useState<CostPreset>("full");
  const [dataSource, setDataSource] = useState<DataSourceMode>("live");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  // In-page view switcher (spec 02 §6.1: in-page branch, not new routes). The
  // `view` enum reserves `"portfolio"` in the type (TradingDeskView) so the
  // Portfolio slice extends it without churn; only desk/reports render today.
  const [view, setView] = useState<TradingDeskView>("desk");
  // Mobile-shell surface selection (FIX-757). Independent of the desktop
  // `view`: both shells render (CSS-toggled at `lg`, the kitchen-sink
  // precedent), so each keeps its own navigation state.
  const [mobileTab, setMobileTab] = useState<MobileTab>("report");
  // Optional per-run user thesis. Frozen into session state at `seedSession`
  // (server-side); editing here after a run starts doesn't touch the running
  // session. A non-null thesis gates the Phase 6 audit.
  const [userThesis, setUserThesis] = useState("");
  const [userThesisRationale, setUserThesisRationale] = useState("");
  // Optional per-run risk-appetite mandate override (FIX-752). `null` = house
  // default (the seed falls back to the selected accounts' mandate). Like
  // `selectedAccountIds`, this is a REFINEMENT, not part of the session keying
  // tuple — re-running with a different mandate resolves the SAME report.
  const [riskMandate, setRiskMandate] = useState<RiskMandateId | null>(null);

  // Pending dispatch: after `selectSession`/`createSession` updates
  // `activeSessionId`, the next render gives us a `useSession` bound to the
  // resolved id. The effect below fires `sendAction` once that render lands.
  const [pendingDispatch, setPendingDispatch] = useState<
    {
      sessionId: string;
      tuple: AnalyzeTuple;
      userThesis: string | null;
      userThesisRationale: string | null;
      riskMandate: RiskMandateId | null;
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
    session: ["costPreset", "userThesis", "userThesisWarning"],
  });
  const liveCostPreset =
    (sessionClientData?.costPreset as CostPreset | undefined) ?? costPreset;
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
  // The Phase 6 memo's own lifecycle status, read live off the same item (the
  // memos collection is `client: { live: true }`) — replaces the retired
  // `memoStatus.thesisAlignment` session mirror.
  const thesisAlignmentStatus =
    (thesisAlignmentItem?.clientData as { status?: MemoStatus } | null)?.status ??
    "pending";

  // Status-bar badge: only shown when a thesis was provided for this run.
  // `pending` while in flight, the alignment verdict once published, and
  // `error` if the Phase 6 audit failed (so it doesn't read "pending" forever).
  const thesisBadge: string | undefined =
    liveUserThesis === null
      ? undefined
      : thesisAlignmentStatus === "published" && thesisAlignment !== null
        ? thesisAlignment
        : thesisAlignmentStatus === "error"
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
      // Freeze the mandate at click time too (the thesis-freeze precedent), so a
      // later dropdown change doesn't reach this in-flight run.
      riskMandate,
    });
  }, [
    tuple,
    matchedSessionId,
    userThesis,
    userThesisRationale,
    riskMandate,
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
        // Restore the toggle to the row's own data source so the tuple-sync
        // effect resolves to exactly this session. Record is a first-class
        // toggle state (a Live + Record run), so it restores as itself.
        if (
          t.dataSource === "fixture" ||
          t.dataSource === "live" ||
          t.dataSource === "record"
        ) {
          setDataSource(t.dataSource);
        }
      }
      flow.selectSession(id);
      setView("desk");
    },
    [flow],
  );

  // Mobile variant of the open-report path: same tuple-first handshake, then
  // route the mobile shell to the Report surface (the desktop `view` write in
  // `handleOpenReport` is harmless there).
  const handleOpenReportMobile = useCallback(
    (id: string) => {
      handleOpenReport(id);
      setMobileTab("report");
    },
    [handleOpenReport],
  );

  // Fires once `useSession` is bound to the resolved session id. Without
  // this, calling `session.sendAction` synchronously after `selectSession`
  // would dispatch against the previously-active session because the hook's
  // sendAction captures `sessionId` from the closing render.
  useEffect(() => {
    if (pendingDispatch === null) return;
    if (flow.activeSessionId !== pendingDispatch.sessionId) return;
    const {
      tuple,
      userThesis: ut,
      userThesisRationale: utr,
      riskMandate: rm,
    } = pendingDispatch;
    setPendingDispatch(null);
    void session.sendAction("analyze", {
      ...tuple,
      userThesis: ut,
      userThesisRationale: utr,
      // `selectedAccountIds` is empty in v1 (the PM suggests an account). The
      // portfolio snapshot is now computed server-side at seed from the app-owned
      // accounts + holdings + quotes tables — no `portfolio` field is dispatched.
      selectedAccountIds: [],
      // Per-run mandate override (FIX-752). Null falls back to the accounts'
      // default at seed. Not a tuple field — it refines, never re-keys the run.
      riskMandate: rm,
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
    <>
      {/* Desktop shell (≥ lg) — the original fixed-viewport grid, unchanged
          apart from the breakpoint gate. Both shells render; CSS picks one
          (the kitchen-sink precedent — no media-query JS, no hydration risk). */}
      <div
        className="hidden h-screen w-screen overflow-hidden lg:grid"
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
            {/* Portfolio actions (saveAccount, getQuotes, etc.) live on the
                portfolio flow, so the Portfolio view gets its own
                provider + session binding that dispatches to that flow. The app-
                owned tables (accounts, holdings, quotes) are shared at the storage
                layer — no data bridge between providers is needed. */}
            <FlowProvider flowKind="portfolio" userId={USER_ID} baseUrl="">
              <PortfolioView />
            </FlowProvider>
          </main>
        ) : (
          <main
            className="grid overflow-hidden"
            style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}
          >
            <ThesesPane session={session} />
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
      </div>

      {/* Mobile shell (< lg, FIX-757) — bottom-tab navigation over one
          full-width surface at a time. `100svh` (not vh/dvh) keeps the chrome
          inside the visible area when mobile browser toolbars expand. The
          content pane content + data hooks are shared with the desktop shell;
          only the shell and navigation differ. */}
      <div className="flex h-svh flex-col overflow-hidden lg:hidden">
        <MobileHeader
          context={
            flow.activeSessionId !== undefined ? `${ticker} · ${date}` : null
          }
          theme={theme}
          onThemeToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          onOpenSettings={() => setInstructionsOpen(true)}
          settingsDisabled={readSessionId === undefined}
        />
        {/* Single-cell grid so each pane stretches to fill both axes without
            needing its own flex-1/w-full (the panes size off their container,
            exactly as the desktop grid cells size them). */}
        <main className="grid min-h-0 flex-1 overflow-hidden">
          {mobileTab === "report" ? (
            <ThesesPane session={session} />
          ) : mobileTab === "transcript" ? (
            <TranscriptPane session={session} />
          ) : mobileTab === "portfolio" ? (
            <FlowProvider flowKind="portfolio" userId={USER_ID} baseUrl="">
              <PortfolioView />
            </FlowProvider>
          ) : (
            <PastReportsPane
              sessions={flow.sessions}
              onOpenReport={handleOpenReportMobile}
            />
          )}
        </main>
        <MobileStatusLine
          state={runState}
          eventCount={session.items.length}
          preset={liveCostPreset}
        />
        <BottomNav
          active={mobileTab}
          onSelect={setMobileTab}
          onNewAnalysis={() => setNewAnalysisOpen(true)}
        />
      </div>

      {/* Dialogs — shared across both shells (rendered once; native <dialog>
          presents as a centered modal on desktop and a bottom sheet below lg). */}
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
        riskMandate={riskMandate}
        onRiskMandateChange={setRiskMandate}
        userThesis={userThesis}
        userThesisRationale={userThesisRationale}
        onUserThesisChange={setUserThesis}
        onUserThesisRationaleChange={setUserThesisRationale}
        onSubmit={() => {
          void handleRun();
          // Land the mobile shell on the Report surface so the new run's
          // stream is visible — submitting from Portfolio/History would
          // otherwise start the run on a tab that doesn't show it. The
          // desktop `view` is deliberately untouched (pre-existing behavior:
          // desktop runs stream into whichever view is showing).
          setMobileTab("report");
        }}
        isRunning={session.isStreaming}
        isExistingSession={isExistingSession}
      />
    </>
  );
}
