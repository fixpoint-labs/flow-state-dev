/**
 * MemoSidebar — 200px-wide phase-grouped list (P5 → P1).
 *
 * All twelve agents from the canonical AGENTS table render here from day
 * one. Phase 1 only populates P1 entries with live status; P2–P5 entries
 * stay in `pending` until those phases ship.
 *
 * `memoStatus` keys are short-name memo keys (e.g. `fundamentals`) read from
 * the live session-state map. Any agent whose short-name doesn't appear in
 * the map is shown as `pending`.
 */
import type { ReactElement } from "react";
import { AgentBadge } from "@/components/agent-badge";
import {
  AGENTS,
  PHASE_GROUPS,
  shortNameForAgent,
  type AgentName,
  type AnyMemoShortName,
} from "@/src/flows/analysis/registry";
import type { MemoStatus } from "@/src/flows/analysis/resources/memos";
import { cn } from "@/lib/utils";

type MemoSidebarProps = {
  memoStatus: Partial<Record<AnyMemoShortName, MemoStatus>>;
  selectedAgent: AgentName | null;
  onSelectAgent: (agent: AgentName) => void;
};

const STATUS_LABEL: Record<MemoStatus | "unavailable", string> = {
  pending: "pending",
  writing: "writing…",
  published: "published",
  error: "error",
  unavailable: "—",
};

function statusForAgent(
  agent: AgentName,
  memoStatus: MemoSidebarProps["memoStatus"],
): MemoStatus | "unavailable" {
  const shortName = shortNameForAgent(agent);
  if (shortName === undefined) return "unavailable";
  return memoStatus[shortName] ?? "pending";
}

export function MemoSidebar({
  memoStatus,
  selectedAgent,
  onSelectAgent,
}: MemoSidebarProps): ReactElement {
  return (
    <nav
      className={cn(
        "w-[200px] shrink-0 overflow-y-auto",
        "border-r border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Theses navigator"
    >
      {PHASE_GROUPS.map((group) => (
        <div key={group.id} className="px-2 pt-3">
          <div className="px-2 pb-1 font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            {group.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {group.agents.map((agent) => {
              const status = statusForAgent(agent, memoStatus);
              const isUnavailable = status === "unavailable";
              const isSelected = selectedAgent === agent;
              return (
                <li key={agent}>
                  <button
                    type="button"
                    onClick={() => onSelectAgent(agent)}
                    disabled={isUnavailable}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                      "text-[12px]",
                      isSelected
                        ? "bg-[color:var(--c-surface-2)] text-[color:var(--c-fg)]"
                        : "text-[color:var(--c-fg-muted)] hover:bg-[color:var(--c-surface-2)]/60",
                      isUnavailable && "opacity-45 cursor-not-allowed",
                    )}
                  >
                    <AgentBadge
                      agent={agent}
                      treatment={isUnavailable ? "subtle" : "medium"}
                    />
                    <span className="flex flex-1 flex-col items-start">
                      <span className="leading-tight">{AGENTS[agent].role}</span>
                      <span
                        className={cn(
                          "font-mono text-[9.5px] leading-tight",
                          status === "writing" && "text-[color:var(--c-accent)]",
                          status === "error" && "text-[color:var(--c-warn)]",
                          (status === "pending" || isUnavailable) &&
                            "text-[color:var(--c-fg-faint)]",
                          status === "published" &&
                            "text-[color:var(--c-live)]",
                        )}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="h-3" />
    </nav>
  );
}
