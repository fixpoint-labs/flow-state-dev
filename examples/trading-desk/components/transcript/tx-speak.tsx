/**
 * tx-speak — stacked badge-above-text row for an agent message.
 *
 * Shows the agent badge + role on top, body text below. While streaming
 * (status `in_progress`), a tail caret blinks in `--c-accent` to telegraph
 * that more text is on the way.
 */
import type { ReactElement } from "react";
import { AgentBadge } from "@/components/agent-badge";
import {
  AGENTS,
  type AgentName,
} from "@/src/flows/trading-desk/agents";
import { cn } from "@/lib/utils";

export type TxSpeakProps = {
  agent: AgentName;
  text: string;
  isStreaming: boolean;
  round?: number;
};

export function TxSpeak({ agent, text, isStreaming, round }: TxSpeakProps): ReactElement {
  const meta = AGENTS[agent];
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2">
      <div className="flex items-center gap-2">
        <AgentBadge agent={agent} treatment="medium" />
        <span className="text-[12px] font-medium text-[color:var(--c-fg)]">
          {meta?.role ?? agent}
        </span>
        {round !== undefined && (
          <span className="font-mono text-[10.5px] text-[color:var(--c-fg-faint)]">
            round {round}
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap pl-6 text-[12.5px] leading-relaxed text-[color:var(--c-fg)]">
        {text}
        {isStreaming && (
          <span
            aria-hidden
            className={cn(
              "ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px]",
              "bg-[color:var(--c-accent)] animate-pulse",
            )}
          />
        )}
      </p>
    </div>
  );
}
