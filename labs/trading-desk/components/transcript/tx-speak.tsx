/**
 * tx-speak — stacked badge-above-text row for an agent message.
 *
 * Shows the agent badge + role on top, body text below. While streaming
 * (status `in_progress`), a tail caret blinks in `--c-accent` to telegraph
 * that more text is on the way.
 */
import type { ReactElement } from "react";
import { Streamdown } from "streamdown";
import { AgentBadge } from "@/components/agent-badge";
import {
  AGENTS,
  type AgentName,
} from "@/flows/analysis/registry";
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
      <div
        className={cn(
          "pl-6 text-[12.5px] leading-relaxed text-[color:var(--c-fg)]",
          // Streamdown emits standard prose elements; tighten spacing so the
          // chat row stays compact instead of inheriting browser defaults.
          "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
          "[&_ul]:my-1 [&_ol]:my-1 [&_ul]:ml-4 [&_ol]:ml-4 [&_ul]:list-disc [&_ol]:list-decimal",
          "[&_li]:my-0.5",
          "[&_h1]:text-[13.5px] [&_h2]:text-[13px] [&_h3]:text-[12.5px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
          "[&_code]:rounded [&_code]:bg-[color:var(--c-surface)] [&_code]:px-1 [&_code]:py-[1px] [&_code]:text-[11.5px]",
          "[&_pre]:my-1 [&_pre]:rounded [&_pre]:bg-[color:var(--c-surface)] [&_pre]:p-2 [&_pre]:text-[11.5px]",
          "[&_a]:text-[color:var(--c-accent)] [&_a]:underline",
        )}
      >
        <Streamdown>{text}</Streamdown>
        {isStreaming && (
          <span
            aria-hidden
            className={cn(
              "ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px]",
              "bg-[color:var(--c-accent)] animate-pulse",
            )}
          />
        )}
      </div>
    </div>
  );
}
