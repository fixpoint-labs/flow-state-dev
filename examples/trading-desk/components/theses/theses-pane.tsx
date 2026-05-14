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
import { useResourceCollectionItem } from "@flow-state-dev/react";
import { MemoSidebar } from "./memo-sidebar";
import { AgentBadge } from "@/components/agent-badge";
import { ThesisHeader } from "./thesis-header";
import { ThesisBody } from "./thesis-body";
import { PmHero } from "./pm-hero";
import { WritingSkeleton } from "./writing-skeleton";
import {
  AGENTS,
  ALL_MEMO_KEYS,
  shortNameForAgent,
  type AgentName,
  type AnyMemoShortName,
} from "@/src/flows/trading-desk/agents";
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

/** Order memos are expected to publish in. Auto-follow walks back-to-front. */
const PUBLISH_ORDER: ReadonlyArray<AnyMemoShortName> = [
  "fundamentals",
  "sentiment",
  "news",
  "technical",
  "bull",
  "bear",
  "researchManager",
  "trader",
  "aggressive",
  "conservative",
  "neutral",
  "riskAssessment",
  "portfolioManager",
];

export function ThesesPane({ session, memoStatus }: ThesesPaneProps): ReactElement {
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);
  const userSelectedRef = useRef(false);

  // Reset manual-selection flag on re-run (detected by streaming → 0 items).
  // Effect (not derived state): synchronizes a ref with an external signal.
  useEffect(() => {
    if (session.isStreaming && session.items.length === 0) {
      userSelectedRef.current = false;
      setSelectedAgent(null);
    }
  }, [session.isStreaming, session.items.length]);

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

  const handleSelectAgent = (agent: AgentName) => {
    userSelectedRef.current = true;
    setSelectedAgent(agent);
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
        {selectedAgent === null ? (
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
    <div className="m-auto max-w-md text-center">
      <p className="text-[12px] leading-relaxed text-[color:var(--c-fg-faint)]">
        Pick a phase entry on the left to see its memo. Each entry
        becomes live once its agent runs.
      </p>
    </div>
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

type MemoClientData = {
  status: MemoStatus;
  label: string | null;
  headline: string | null;
  rating: string | null;
  body: ThesisSection[] | null;
  metrics: Record<string, string> | null;
  errorMessage: string | null;
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
  if (agent === "portfolioManager") {
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
      />
      {data?.body !== null && data?.body !== undefined && data.body.length > 0 && (
        <ThesisBody body={data.body} />
      )}
      <p className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        end of memo · {data?.label ?? AGENTS[agent]?.role ?? ""} · {agent}
      </p>
    </article>
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
