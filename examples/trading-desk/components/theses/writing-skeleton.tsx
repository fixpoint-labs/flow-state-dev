/**
 * writing-skeleton — placeholder shimmer rendered while a memo is `writing`.
 * Includes a footer line nudging the reader that structured output will
 * land at the end of the phase.
 */
import type { ReactElement } from "react";
import { AgentBadge } from "@/components/agent-badge";
import {
  AGENTS,
  type AgentName,
} from "@/src/flows/trading-desk/agents";
import { cn } from "@/lib/utils";

export type WritingSkeletonProps = {
  agent: AgentName;
};

export function WritingSkeleton({ agent }: WritingSkeletonProps): ReactElement {
  const meta = AGENTS[agent];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <AgentBadge agent={agent} treatment="medium" />
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-[color:var(--c-fg)]">
            {meta?.role ?? agent}
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-accent)]">
            ●●● writing…
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <SkeletonLine width="w-3/4" />
        <SkeletonLine width="w-full" />
        <SkeletonLine width="w-5/6" />
        <SkeletonLine width="w-1/2" />
      </div>
      <p className="text-[11px] italic text-[color:var(--c-fg-faint)]">
        streaming structured output… memo will land at end of phase
      </p>
    </div>
  );
}

function SkeletonLine({ width }: { width: string }): ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        "h-3 rounded-sm bg-[color:var(--c-surface-2)] animate-pulse",
        width,
      )}
    />
  );
}
