"use client";

import type { ContainerItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  Loader2Icon,
  RadioIcon,
} from "lucide-react";
import Markdown from "react-markdown";

/**
 * Actor contribution data emitted by reactive blackboard actor bodies.
 * Each actor emits a component item keyed by actor name after completing.
 */
type ActorContribution = {
  actor: string;
  role: string;
  contribution: string;
};

const ACTOR_STYLES: Record<string, { label: string; color: string }> = {
  explorer: { label: "Explorer", color: "text-blue-500" },
  analyst: { label: "Analyst", color: "text-amber-500" },
  challenger: { label: "Challenger", color: "text-rose-500" },
};

const EXPECTED_ROLES = ["explorer", "analyst", "challenger"];

/**
 * Container renderer for the reactive blackboard pattern. The mesh emit
 * sequencer creates a container with component "reactive-blackboard".
 * Each actor body emits a keyed "rb-actor" component item on completion.
 *
 * Register via:
 *   renderers={{ container: { "reactive-blackboard": ReactiveBlackboard } }}
 */
export function ReactiveBlackboard({
  item,
  componentsByKey,
}: {
  item: ContainerItem;
  componentsByKey: Map<string, Record<string, unknown>>;
}) {
  const isFinished = item.status === "completed";

  const contributions: Array<ActorContribution & { key: string }> = [];
  for (const [key, data] of componentsByKey) {
    if (data.role && data.contribution) {
      contributions.push({ key, ...(data as unknown as ActorContribution) });
    }
  }

  const completedCount = contributions.length;
  const expectedCount = EXPECTED_ROLES.length;

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <RadioIcon
            className="h-3.5 w-3.5 text-cyan-500"
            aria-hidden="true"
          />
          <p className="text-sm font-medium leading-snug">
            Reactive Blackboard
          </p>
        </div>
        <span className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground tabular-nums">
          {isFinished ? (
            <CheckCircle2Icon
              className="h-3 w-3 text-cyan-500"
              aria-hidden="true"
            />
          ) : (
            <Loader2Icon
              className="h-3 w-3 animate-spin text-cyan-500"
              aria-hidden="true"
            />
          )}
          {completedCount}/{expectedCount} actors
        </span>
      </div>

      <div className="space-y-1.5">
        {EXPECTED_ROLES.map((role) => {
          const entry = contributions.find((c) => c.role === role);
          const style = ACTOR_STYLES[role] ?? {
            label: role,
            color: "text-muted-foreground",
          };

          if (!entry) {
            return (
              <div key={role} className="flex items-center gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                    "bg-muted text-muted-foreground"
                  )}
                >
                  {style.label}
                </span>
                {!isFinished && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground italic">
                    <Loader2Icon
                      className="h-2.5 w-2.5 animate-spin"
                      aria-hidden="true"
                    />
                    analyzing...
                  </span>
                )}
              </div>
            );
          }

          return (
            <ActorEntry
              key={role}
              label={style.label}
              color={style.color}
              text={entry.contribution}
            />
          );
        })}
      </div>
    </div>
  );
}

function ActorEntry({
  label,
  color,
  text,
}: {
  label: string;
  color: string;
  text: string;
}) {
  const isLong = text.length > 120;

  if (!isLong) {
    return (
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            "bg-muted",
            color
          )}
        >
          {label}
        </span>
        <span className="text-xs leading-snug">
          <EntryMarkdown text={text} />
        </span>
      </div>
    );
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            "bg-muted",
            color
          )}
        >
          {label}
        </span>
        <span className="flex-1 truncate text-xs leading-snug text-muted-foreground">
          {text.slice(0, 100)}...
        </span>
        <ChevronRightIcon
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1.5 pl-5">
        <EntryMarkdown text={text} />
      </div>
    </details>
  );
}

const headingComponent = ({ children }: { children?: React.ReactNode }) => (
  <p className="font-semibold">{children}</p>
);
const markdownComponents = {
  h1: headingComponent,
  h2: headingComponent,
  h3: headingComponent,
  h4: headingComponent,
  h5: headingComponent,
  h6: headingComponent,
};

function EntryMarkdown({ text }: { text: string }) {
  return (
    <div
      className={cn(
        "prose-none text-xs leading-snug text-muted-foreground",
        "[&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[10px]",
        "[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-2 [&_blockquote]:italic"
      )}
    >
      <Markdown components={markdownComponents}>{text}</Markdown>
    </div>
  );
}
