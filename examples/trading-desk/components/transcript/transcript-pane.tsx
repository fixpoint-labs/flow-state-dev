/**
 * TranscriptPane — left pane.
 *
 * Reads `session.items` and dispatches each item to the right sub-renderer:
 *   - `container` items with `component: "analyst-phase"` (and any later
 *     `phase-*` component) → `TxPhase` divider.
 *   - `tool_output` items → `TxTool` row, with FIXTURE/LIVE pill drawn
 *     from the output's `source` field.
 *   - `message` items from sub-agents or primary agents → `TxSpeak` row.
 *   - `block_trace` items with terminal `output` and an emitting agent in
 *     `{researchManager, trader, portfolioManager}` (Phase 2+) →
 *     `TxStruct` collapsible. Phase 1 analyst structured outputs are
 *     intentionally suppressed from the transcript per the design — they
 *     surface only in the right pane.
 *
 * Auto-scrolls to the bottom on new items if the user is near the bottom.
 */
"use client";

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import type { SessionView } from "@flow-state-dev/react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { TxPhase } from "./tx-phase";
import { TxTool } from "./tx-tool";
import { TxSpeak } from "./tx-speak";
import { TxStruct } from "./tx-struct";
import {
  AGENTS,
  type AgentName,
} from "@/src/flows/trading-desk/agents";
import { cn } from "@/lib/utils";

type Props = {
  session: SessionView;
};

const PRIMARY_STRUCT_AGENTS = new Set<string>([
  "researchManager",
  "trader",
  "portfolioManager",
  "thesisValidator",
]);

const PHASE_1_ANALYST_AGENTS = new Set<string>([
  "fundamentalsAnalyst",
  "sentimentAnalyst",
  "newsAnalyst",
  "technicalAnalyst",
  "companyProfileAnalyst",
]);

export function TranscriptPane({ session }: Props): ReactElement {
  const items = session.items as OutputItem[];
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // Track whether the user is near the bottom; only auto-scroll while sticky.
  // This is a side effect on a DOM-derived value (scroll position) — `useEffect`
  // is the right tool, not `useMemo`.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 80;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll on new items if the user has not scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items.length]);

  const rendered = useMemo(() => buildRows(items), [items]);

  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden",
        "border-l border-r border-[color:var(--c-border)] bg-[color:var(--c-bg)]",
      )}
      aria-label="Transcript"
    >
      <div className="border-b border-[color:var(--c-border)] px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          transcript
        </h2>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {rendered.length === 0 ? (
          <p className="px-6 pt-8 text-center text-[12px] leading-relaxed text-[color:var(--c-fg-faint)]">
            Run an analysis to populate the transcript. Phase dividers, tool
            calls, and analyst speak rows will stream in live.
          </p>
        ) : (
          rendered
        )}
      </div>
    </section>
  );
}

function buildRows(items: OutputItem[]): ReactElement[] {
  const rows: ReactElement[] = [];
  // Group `message` items by stable id so streaming deltas update the same
  // row rather than appending duplicates.
  for (const item of items) {
    if (item.transient === true) continue;
    if (item.type === "container") {
      const container = item as Extract<OutputItem, { type: "container" }>;
      // Phase-divider containers: P1 ships `analyst-phase`; P2+ will ship
      // `phase-2-debate`, `phase-3-trader`, etc. Match either shape.
      const isPhaseDivider =
        typeof container.component === "string" &&
        (container.component === "analyst-phase" ||
          container.component.startsWith("phase-"));
      if (isPhaseDivider && container.label !== undefined) {
        rows.push(<TxPhase key={`phase-${container.id}`} label={container.label} />);
      }
      continue;
    }
    if (item.type === "tool_output") {
      const tool = item as Extract<OutputItem, { type: "tool_output" }>;
      const argsStr = tool.toolCall?.arguments ?? "";
      const argsPreview = oneLine(argsStr) || "(no args)";
      const output = tool.output as Record<string, unknown> | undefined;
      const source =
        output !== undefined && typeof output.source === "string"
          ? output.source
          : undefined;
      const bytes =
        output !== undefined ? JSON.stringify(output).length : undefined;
      rows.push(
        <TxTool
          key={tool.id}
          agent={tool.agentName as AgentName | undefined}
          toolName={tool.toolCall?.name ?? tool.blockName}
          argsPreview={argsPreview}
          status={tool.status}
          source={source}
          output={output}
          bytes={bytes}
          errorMessage={tool.error?.message}
        />,
      );
      continue;
    }
    if (item.type === "message") {
      const message = item as Extract<OutputItem, { type: "message" }>;
      if (message.role !== "assistant") continue;
      const agentName = message.agentName as AgentName | undefined;
      if (agentName === undefined || AGENTS[agentName] === undefined) continue;
      const text = message.content
        .filter((c) => c.type === "output_text")
        .map((c) => (c as { text: string }).text)
        .join("");
      if (text.length === 0 && message.status !== "in_progress") continue;
      rows.push(
        <TxSpeak
          key={message.id}
          agent={agentName}
          text={text}
          isStreaming={message.status === "in_progress"}
        />,
      );
      continue;
    }
    if (item.type === "component") {
      // Phase 2+ agents emit a `component: "thesis-card"` item carrying
      // their structured output. Phase 1 analyst structured outputs are
      // suppressed from the transcript per the design — they surface only
      // in the right pane — so skip components emitted from analysts.
      const cmp = item as Extract<OutputItem, { type: "component" }>;
      if (cmp.component !== "thesis-card") continue;
      const agentName = cmp.agentName;
      if (agentName === undefined || PHASE_1_ANALYST_AGENTS.has(agentName)) continue;
      if (!PRIMARY_STRUCT_AGENTS.has(agentName)) continue;
      const meta = AGENTS[agentName as AgentName];
      const label = meta?.role ?? agentName;
      rows.push(<TxStruct key={cmp.id} label={label} data={cmp.data} />);
      continue;
    }
  }
  return rows;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}
