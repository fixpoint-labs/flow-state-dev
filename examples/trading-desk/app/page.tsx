"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { createSessionClient, type SessionSummary } from "@flow-state-dev/client";
import { FlowProvider, useFlow, useSession, useClientData } from "@flow-state-dev/react";
import { TopBar, type CostPreset, type DataSourceMode } from "@/components/topbar";
import { StatusBar } from "@/components/status-bar";
import { TranscriptPane } from "@/components/transcript/transcript-pane";
import { ThesesPane } from "@/components/theses/theses-pane";
import type { MemoStatus } from "@/src/flows/trading-desk/resources";
import type { AnyMemoShortName } from "@/src/flows/trading-desk/agents";

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
  const flow = useFlow({ autoCreateSession: false });
  const session = useSession(flow.activeSessionId);

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

  // Pending dispatch: after `selectSession`/`createSession` updates
  // `activeSessionId`, the next render gives us a `useSession` bound to the
  // resolved id. The effect below fires `sendAction` once that render lands.
  const [pendingDispatch, setPendingDispatch] = useState<
    { sessionId: string; tuple: AnalyzeTuple } | null
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
    session: ["costPreset", "memoStatus"],
  });
  const liveCostPreset =
    (sessionClientData?.costPreset as CostPreset | undefined) ?? costPreset;
  const memoStatus =
    (sessionClientData?.memoStatus as
      | Partial<Record<AnyMemoShortName, MemoStatus>>
      | undefined) ?? {};

  const handleRun = useCallback(async () => {
    const tuple: AnalyzeTuple = { ticker, date, costPreset, dataSource };

    let targetId = findSessionForTuple(flow.sessions, tuple);
    if (targetId === undefined) {
      const created = await sessionClient.createSession({
        flowKind: FLOW_KIND,
        userId: USER_ID,
        title: titleForTuple(tuple),
        metadata: tuple,
      });
      targetId = created.id;
      await flow.refreshSessions();
    }

    if (flow.activeSessionId !== targetId) {
      flow.selectSession(targetId);
    }
    setPendingDispatch({ sessionId: targetId, tuple });
  }, [ticker, date, costPreset, dataSource, flow, sessionClient]);

  // Fires once `useSession` is bound to the resolved session id. Without
  // this, calling `session.sendAction` synchronously after `selectSession`
  // would dispatch against the previously-active session because the hook's
  // sendAction captures `sessionId` from the closing render.
  useEffect(() => {
    if (pendingDispatch === null) return;
    if (flow.activeSessionId !== pendingDispatch.sessionId) return;
    const { tuple } = pendingDispatch;
    setPendingDispatch(null);
    void session.sendAction("analyze", tuple);
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
        ticker={ticker}
        date={date}
        costPreset={costPreset}
        dataSource={dataSource}
        onTickerChange={setTicker}
        onDateChange={setDate}
        onCostPresetChange={setCostPreset}
        onDataSourceChange={setDataSource}
        onRun={() => {
          void handleRun();
        }}
        isRunning={session.isStreaming}
        theme={theme}
        onThemeToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      <main
        className="grid overflow-hidden"
        style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)" }}
      >
        <TranscriptPane session={session} />
        <ThesesPane session={session} memoStatus={memoStatus} />
      </main>
      <StatusBar
        state={runState}
        eventCount={session.items.length}
        preset={liveCostPreset}
      />
    </div>
  );
}
