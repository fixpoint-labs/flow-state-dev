"use client";

import type { ComponentItem, ContainerItem, OutputItem } from "@flow-state-dev/core/items";
import { useContainerItems } from "@flow-state-dev/react";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  Loader2Icon,
  RadioIcon,
  SearchIcon,
  LightbulbIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { useMemo } from "react";
import Markdown from "react-markdown";
import { useSessionItems } from "./session-items-context";

/** An entry extracted from rb-entry component items emitted by appendEntry. */
type BlackboardEntry = {
  type: string;
  topic: string;
  body?: string;
};

/**
 * Actor definition — maps entry types to the actor that produced them.
 * The reactive chain is: request → observation (Explorer) → finding (Analyst) → challenge (Challenger).
 */
type ActorDef = {
  label: string;
  entryType: string;
  color: string;
  activeLabel: string;
  icon: typeof SearchIcon;
};

const ACTORS: ActorDef[] = [
  {
    label: "Explorer",
    entryType: "observation",
    color: "text-blue-500",
    activeLabel: "Exploring...",
    icon: SearchIcon,
  },
  {
    label: "Analyst",
    entryType: "finding",
    color: "text-amber-500",
    activeLabel: "Analyzing observations...",
    icon: LightbulbIcon,
  },
  {
    label: "Challenger",
    entryType: "challenge",
    color: "text-rose-500",
    activeLabel: "Challenging findings...",
    icon: ShieldAlertIcon,
  },
];

/**
 * Container renderer for the reactive blackboard pattern. Shows a
 * chain-of-thought timeline grouped by actor — Explorer, Analyst,
 * Challenger — with each actor's actual contributions visible.
 *
 * Register via:
 *   <FlowProvider renderers={{ container: { "reactive-blackboard": ReactiveBlackboard } }}>
 */
export function ReactiveBlackboard({ item }: { item: ContainerItem }) {
  const allItems = useSessionItems();
  const { items: ownedItems } = useContainerItems(item, allItems);

  // Scope to this request — prevents stale entries from previous requests
  // polluting the current view.
  const requestId = (item as OutputItem & { requestId?: string }).requestId;

  // Extract entries from rb-entry component items. Search owned items first,
  // then fall back to scanning session items scoped to this request —
  // ownedBy may not propagate through nested forEachBackground dispatches.
  const entries = useMemo(() => {
    const result: BlackboardEntry[] = [];
    const hasOwnedEntries = ownedItems.some(
      (i) => i.type === "component" && (i as ComponentItem).component === "rb-entry"
    );
    const source = hasOwnedEntries
      ? ownedItems
      : allItems.filter(
          (i) => requestId && (i as OutputItem & { requestId?: string }).requestId === requestId
        );

    for (const i of source) {
      if (i.type !== "component") continue;
      const comp = i as ComponentItem;
      if (comp.component !== "rb-entry") continue;
      const { type, topic, body } = comp.data as Record<string, unknown>;
      if (typeof type === "string" && typeof topic === "string") {
        result.push({ type, topic, body: typeof body === "string" ? body : undefined });
      }
    }
    return result;
  }, [ownedItems, allItems, requestId]);

  // Collect tool call items for chain-of-thought display.
  // Same fallback: owned items first, then request-scoped.
  const toolCalls = useMemo(() => {
    type ToolCallInfo = { name: string; query?: string };
    const result: ToolCallInfo[] = [];
    const hasOwnedTools = ownedItems.some((i) => i.type === "block_tool_output");
    const source = hasOwnedTools
      ? ownedItems
      : allItems.filter(
          (i) =>
            requestId &&
            (i as OutputItem & { requestId?: string }).requestId === requestId
        );

    for (const i of source) {
      if (i.type !== "block_tool_output") continue;
      const tool = i as import("@flow-state-dev/core/items").BlockToolOutputItem;
      let query: string | undefined;
      try {
        const args = JSON.parse(tool.toolCall.arguments);
        query = typeof args.query === "string" ? args.query : undefined;
      } catch { /* ignore parse errors */ }
      result.push({ name: tool.toolCall.name, query });
    }
    return result;
  }, [ownedItems, allItems, requestId]);

  const isFinished = item.status === "completed";

  // Determine which actors have produced entries and which are active.
  const actorStates = useMemo(() => {
    return ACTORS.map((actor, i) => {
      const actorEntries = entries.filter((e) => e.type === actor.entryType);
      const hasEntries = actorEntries.length > 0;

      // An actor is "active" if the container is running, this actor has no entries yet,
      // and the previous actor has finished (has entries) — or it's the first actor.
      const prevHasEntries = i === 0 || entries.some((e) => e.type === ACTORS[i - 1].entryType);
      const isActive = !isFinished && !hasEntries && prevHasEntries;

      return { ...actor, entries: actorEntries, hasEntries, isActive };
    });
  }, [entries, isFinished]);

  const visibleActors = actorStates.filter((a) => a.hasEntries || a.isActive);

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <RadioIcon
            className="h-3.5 w-3.5 text-cyan-500"
            aria-hidden="true"
          />
          <p className="text-sm font-medium leading-snug">
            Blackboard
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
          {isFinished ? "complete" : "analyzing"}
        </span>
      </div>

      {/* Chain of thought — per actor */}
      <div className="space-y-2">
        {/* Tool calls as chain-of-thought steps */}
        {toolCalls.length > 0 && (
          <div className="space-y-1">
            {toolCalls.map((tc, i) => (
              <div key={i} className="flex items-center gap-1.5">
                { tc.name === 'search' ? 
                  <SearchIcon className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden="true" /> : 
                  <LightbulbIcon className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                }
                
                <span className="text-xs text-muted-foreground">
                  {tc.query ? `Searching: ${tc.query}` : tc.name}
                </span>
              </div>
            ))}
          </div>
        )}

        {visibleActors.length > 0
          ? visibleActors.map((actor) => (
              <ActorSection key={actor.entryType} actor={actor} />
            ))
          : !isFinished && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground italic">
                <Loader2Icon
                  className="h-3 w-3 animate-spin"
                  aria-hidden="true"
                />
                Starting analysis...
              </div>
            )}
      </div>
    </div>
  );
}

/**
 * A single actor's section in the chain of thought. Shows the actor label,
 * an active spinner while working, and collapsible contributions.
 */
function ActorSection({
  actor,
}: {
  actor: ActorDef & {
    entries: BlackboardEntry[];
    hasEntries: boolean;
    isActive: boolean;
  };
}) {
  const Icon = actor.icon;

  if (actor.isActive && !actor.hasEntries) {
    return (
      <div className="flex items-center gap-1.5">
        <Loader2Icon
          className={cn("h-3 w-3 animate-spin", actor.color)}
          aria-hidden="true"
        />
        <span className={cn("text-xs font-medium", actor.color)}>
          {actor.activeLabel}
        </span>
      </div>
    );
  }

  return (
    <details className="group" open>
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <Icon className={cn("h-3 w-3 shrink-0", actor.color)} aria-hidden="true" />
        <span className={cn("text-xs font-medium", actor.color)}>
          {actor.label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {actor.entries.length} {actor.entries.length === 1 ? "entry" : "entries"}
        </span>
        <ChevronRightIcon
          className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1 space-y-1 pl-[18px]">
        {actor.entries.map((entry, i) => (
          <EntryItem key={i} entry={entry} />
        ))}
      </div>
    </details>
  );
}

/** A single entry contribution within an actor's section. */
function EntryItem({ entry }: { entry: BlackboardEntry }) {
  if (!entry.body) {
    return (
      <div className="text-xs text-muted-foreground">{entry.topic}</div>
    );
  }

  const isShort = entry.body.length <= 150;

  if (isShort) {
    return (
      <div className="text-xs leading-snug">
        <span className="font-medium text-foreground/70">{entry.topic}</span>
        <span className="text-muted-foreground"> — </span>
        <span className="text-muted-foreground">{entry.body}</span>
      </div>
    );
  }

  return (
    <details className="group/entry">
      <summary className="flex cursor-pointer list-none items-start gap-1 text-xs leading-snug">
        <span className="font-medium text-foreground/70">{entry.topic}</span>
        <span className="flex-1 truncate text-muted-foreground">
          — {entry.body.slice(0, 80)}...
        </span>
        <ChevronRightIcon
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform group-open/entry:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1 pl-0">
        <EntryMarkdown text={entry.body} />
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
