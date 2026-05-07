/**
 * ThesesPane — right pane: sidebar + memo doc area.
 *
 * Step 4 stub: sidebar groups render with live `memoStatus` once seeded,
 * and the memo doc area shows a placeholder until Step 8 wires the doc
 * dispatcher (PMHero / ThesisHeader+Body / writing skeleton / pending
 * card).
 */
"use client";

import { useState, type ReactElement } from "react";
import { MemoSidebar } from "./memo-sidebar";
import { AgentBadge } from "@/components/agent-badge";
import {
  AGENTS,
  type AgentName,
  type Phase1MemoShortName,
} from "@/src/flows/trading-desk/agents";
import type { MemoStatus } from "@/src/flows/trading-desk/resources";
import { cn } from "@/lib/utils";

type ThesesPaneProps = {
  memoStatus: Partial<Record<Phase1MemoShortName, MemoStatus>>;
};

export function ThesesPane({ memoStatus }: ThesesPaneProps): ReactElement {
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);

  return (
    <section
      className="flex overflow-hidden bg-[color:var(--c-bg)]"
      aria-label="Theses"
    >
      <MemoSidebar
        memoStatus={memoStatus}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
      />
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        {selectedAgent === null ? <EmptySelection /> : (
          <PendingDoc agent={selectedAgent} />
        )}
      </div>
    </section>
  );
}

function EmptySelection(): ReactElement {
  return (
    <div className="m-auto max-w-md text-center">
      <p className="text-[12px] leading-relaxed text-[color:var(--c-fg-faint)]">
        Pick a phase entry on the left to see its memo. Phase 1 entries become
        live once the analyst fan-out lands in Step 6. Until then this
        scaffolding is intentionally sparse.
      </p>
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
            {meta.role}
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            awaiting upstream phases
          </span>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-[color:var(--c-fg-muted)]">
        This memo will populate once the upstream phases land. Phase 1 ships
        the four analyst entries (Fundamentals, Sentiment, News, Technical);
        all other entries are scaffolding.
      </p>
    </div>
  );
}
