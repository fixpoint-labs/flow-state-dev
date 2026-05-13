"use client";

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { FlowProvider, useFlow, useSession, useClientData } from "@flow-state-dev/react";
import { TopBar, type CostPreset, type DataSourceMode } from "@/components/topbar";
import { StatusBar } from "@/components/status-bar";
import { TranscriptPane } from "@/components/transcript/transcript-pane";
import { ThesesPane } from "@/components/theses/theses-pane";
import type { MemoStatus } from "@/src/flows/trading-desk/resources";
import type { AnyMemoShortName } from "@/src/flows/trading-desk/agents";

const DEFAULT_TICKER = "NVDA";

/** Format today as YYYY-MM-DD. Evaluated per-render so the default stays
 *  fresh across the lifetime of a long-running Next.js server. */
function todayIsoDate(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

export default function Page(): ReactElement {
  return (
    <FlowProvider flowKind="trading-desk" userId="devuser" baseUrl="">
      <TradingDeskApp />
    </FlowProvider>
  );
}

function TradingDeskApp(): ReactElement {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  const [ticker, setTicker] = useState(DEFAULT_TICKER);
  // Lazy initializer so the date is captured at the first render of this
  // mount, not at module load. Avoids stale "today" in long-running servers.
  const [date, setDate] = useState(() => todayIsoDate());
  const [costPreset, setCostPreset] = useState<CostPreset>("fast");
  const [dataSource, setDataSource] = useState<DataSourceMode>("fixture");
  const [theme, setTheme] = useState<"light" | "dark">("dark");

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

  const handleRun = useCallback(() => {
    if (flow.activeSessionId === undefined) return;
    void session.sendAction("analyze", {
      ticker,
      date,
      costPreset,
      dataSource,
    });
  }, [flow.activeSessionId, session, ticker, date, costPreset, dataSource]);

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
        onRun={handleRun}
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
