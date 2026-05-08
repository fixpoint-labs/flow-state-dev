"use client";

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { FlowProvider, useFlow, useSession, useClientData } from "@flow-state-dev/react";
import { TopBar, type CostPreset, type DataSourceMode } from "@/components/topbar";
import { StatusBar } from "@/components/status-bar";
import { TranscriptPane } from "@/components/transcript/transcript-pane";
import { ThesesPane } from "@/components/theses/theses-pane";
import type { MemoStatus } from "@/src/flows/trading-desk/resources";
import type { Phase1MemoShortName } from "@/src/flows/trading-desk/agents";

const DEFAULT_TICKER = "NVDA";
const DEFAULT_DATE = "2026-05-06";

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
  const [date, setDate] = useState(DEFAULT_DATE);
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
      | Partial<Record<Phase1MemoShortName, MemoStatus>>
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
        style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}
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
