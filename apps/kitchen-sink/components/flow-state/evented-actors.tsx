"use client";

import type {
  ComponentItem,
  ContainerItem,
  OutputItem,
} from "@flow-state-dev/core/items";
import type { BlockToolOutputItem } from "@flow-state-dev/core/items";
import { useContainerItems } from "@flow-state-dev/react";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleIcon,
  Loader2Icon,
  LightbulbIcon,
  SearchIcon,
  ShieldAlertIcon,
  TelescopeIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { useSessionItems } from "./session-items-context";
import { Shimmer } from "./shimmer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventedActorsEntry = {
  type: string;
  topic: string;
  body?: string;
};

type ToolCall = {
  name: string;
  query?: string;
  /** Summarized output — first few result titles/URLs for search, truncated text for others. */
  resultSummary?: string[];
};

/** Tool calls grouped by tool name for display as separate steps. */
type ToolGroup = {
  name: string;
  displayName: string;
  calls: ToolCall[];
};

/** Converts camelCase/kebab-case tool names to Title Case (e.g. "fetchWeb" → "Fetch Web"). */
function formatToolName(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type StepStatus = "complete" | "active" | "pending";

type ActorDef = {
  label: string;
  entryType: string;
  activeLabel: string;
  icon: typeof SearchIcon;
};

const ACTORS: ActorDef[] = [
  {
    label: "Explorer",
    entryType: "observation",
    activeLabel: "Exploring the topic...",
    icon: TelescopeIcon,
  },
  {
    label: "Analyst",
    entryType: "finding",
    activeLabel: "Analyzing observations...",
    icon: LightbulbIcon,
  },
  {
    label: "Challenger",
    entryType: "challenge",
    activeLabel: "Challenging findings...",
    icon: ShieldAlertIcon,
  },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EventedActors({ item }: { item: ContainerItem }) {
  const [isOpen, setIsOpen] = useState(true);
  const allItems = useSessionItems();
  const { items: ownedItems } = useContainerItems(item, allItems);

  const requestId = (item as OutputItem & { requestId?: string }).requestId;

  // Resolve items scoped to this request. Prefer owned items; fall back
  // to request-scoped session items when ownedBy doesn't propagate
  // through nested forEachBackground dispatches.
  const scopedItems = useMemo(() => {
    const hasOwned = ownedItems.some(
      (i) =>
        i.type === "component" &&
        (i as ComponentItem).component === "rb-entry"
    );
    if (hasOwned) return ownedItems;
    return allItems.filter(
      (i) =>
        requestId &&
        (i as OutputItem & { requestId?: string }).requestId === requestId
    );
  }, [ownedItems, allItems, requestId]);

  const entries = useMemo(() => {
    const result: EventedActorsEntry[] = [];
    for (const i of scopedItems) {
      if (i.type !== "component") continue;
      const comp = i as ComponentItem;
      if (comp.component !== "rb-entry") continue;
      const { type, topic, body } = comp.data as Record<string, unknown>;
      if (typeof type === "string" && typeof topic === "string") {
        result.push({
          type,
          topic,
          body: typeof body === "string" ? body : undefined,
        });
      }
    }
    return result;
  }, [scopedItems]);

  // Group tool calls by tool name for per-tool steps.
  const toolGroups = useMemo(() => {
    const calls: ToolCall[] = [];
    for (const i of scopedItems) {
      if (i.type !== "block_tool_output") continue;
      const tool = i as BlockToolOutputItem;
      let query: string | undefined;
      let resultSummary: string[] | undefined;
      try {
        const args = JSON.parse(tool.toolCall.arguments);
        query = typeof args.query === "string" ? args.query : undefined;
      } catch {
        /* ignore */
      }

      // Extract result summaries from tool output.
      try {
        const out = tool.output;
        if (typeof out === "string") {
          // Plain text output — take first line as summary.
          const first = out.split("\n")[0].trim();
          if (first) resultSummary = [first.slice(0, 120)];
        } else if (Array.isArray(out)) {
          // Array of results (common for search) — extract titles/URLs.
          resultSummary = out.slice(0, 5).map((r: any) => {
            if (typeof r === "string") return r.slice(0, 120);
            const title = r.title ?? r.name ?? r.url ?? "";
            const url = r.url ? ` — ${new URL(r.url).hostname}` : "";
            return `${title}${url}`.slice(0, 120);
          }).filter(Boolean);
        } else if (out && typeof out === "object") {
          // Object with results array (e.g. { results: [...] }).
          const results = (out as any).results ?? (out as any).items ?? (out as any).data;
          if (Array.isArray(results)) {
            resultSummary = results.slice(0, 5).map((r: any) => {
              if (typeof r === "string") return r.slice(0, 120);
              const title = r.title ?? r.name ?? r.url ?? "";
              const url = r.url ? ` — ${new URL(r.url).hostname}` : "";
              return `${title}${url}`.slice(0, 120);
            }).filter(Boolean);
          }
        }
      } catch {
        /* ignore parse errors */
      }

      calls.push({ name: tool.toolCall.name, query, resultSummary });
    }

    const groupMap = new Map<string, ToolCall[]>();
    for (const tc of calls) {
      const group = groupMap.get(tc.name) ?? [];
      group.push(tc);
      groupMap.set(tc.name, group);
    }

    const groups: ToolGroup[] = [];
    for (const [name, groupCalls] of groupMap) {
      groups.push({ name, displayName: formatToolName(name), calls: groupCalls });
    }
    return groups;
  }, [scopedItems]);

  // Derive "finished" from data, not item.status — the container item's
  // status transitions to "completed" before React renders intermediate
  // states, and on reload everything loads as already completed.
  // The chain is done when ALL actor tiers have produced entries.
  const allActorsComplete = ACTORS.every(
    (actor) => entries.some((e) => e.type === actor.entryType)
  );
  const isFinished = allActorsComplete;

  // Build actor step states.
  const steps = useMemo(() => {
    return ACTORS.map((actor, i) => {
      const actorEntries = entries.filter((e) => e.type === actor.entryType);
      const hasEntries = actorEntries.length > 0;
      const prevDone =
        i === 0 ||
        entries.some((e) => e.type === ACTORS[i - 1].entryType);

      let status: StepStatus = "pending";
      if (hasEntries) {
        status = "complete";
      } else if (!isFinished && prevDone) {
        status = "active";
      }

      return { ...actor, entries: actorEntries, status };
    });
  }, [entries, isFinished]);

  const hasTools = toolGroups.length > 0;

  const visibleSteps = steps.filter(
    (s) => s.status !== "pending"
  );

  return (
    <div className="not-prose my-2 rounded-md border bg-card text-card-foreground">
      {/* Header — collapsible trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200",
            !isOpen && "-rotate-90"
          )}
          aria-hidden="true"
        />
        <span className="text-sm font-medium">Evented Actors</span>
      </button>

      {/* Content — timeline */}
      {isOpen && (
        <div className="border-t px-3 pb-1 pt-0">
          {(() => {
            // Collect all visible steps to determine isLast for each.
            type StepDesc = { key: string; render: (isLast: boolean) => React.ReactNode };
            const allSteps: StepDesc[] = [];

            // Tool groups
            for (const group of toolGroups) {
              const toolStatus: StepStatus =
                isFinished || entries.length > 0 ? "complete" : "active";
              const label =
                toolStatus === "active"
                  ? `${group.displayName}...`
                  : `${group.displayName} — ${group.calls.length} ${group.calls.length === 1 ? "call" : "calls"}`;

              allSteps.push({
                key: `tool-${group.name}`,
                render: (last) => (
                  <Step
                    icon={group.name === "search" ? SearchIcon : LightbulbIcon}
                    label={label}
                    status={toolStatus}
                    isLast={last}
                  >
                    {group.calls.length > 0 && group.calls.map((c, i) => (
                      <StepItem key={i} isLast={i === group.calls.length - 1}>
                        <ToolCallItem call={c} />
                      </StepItem>
                    ))}
                  </Step>
                ),
              });
            }

            // Actor steps
            for (const step of visibleSteps) {
              allSteps.push({
                key: `actor-${step.entryType}`,
                render: (last) => (
                  <Step
                    icon={step.icon}
                    label={
                      step.status === "active"
                        ? step.activeLabel
                        : `${step.label} — ${step.entries.length} ${step.entries.length === 1 ? "entry" : "entries"}`
                    }
                    status={step.status}
                    isLast={last}
                  >
                    {step.entries.length > 0 && step.entries.map((entry, i) => (
                      <StepItem key={i} isLast={i === step.entries.length - 1}>
                        <EntryItem entry={entry} />
                      </StepItem>
                    ))}
                  </Step>
                ),
              });
            }

            // Initial shimmer state
            if (!hasTools && visibleSteps.length === 0 && !isFinished) {
              allSteps.push({
                key: "shimmer",
                render: (last) => (
                  <Step icon={TelescopeIcon} label="" status="active" isLast={last}>
                    <Shimmer className="text-xs" duration={2}>
                      Scribbling...
                    </Shimmer>
                  </Step>
                ),
              });
            }

            return allSteps.map((s, i) => (
              <div key={s.key}>{s.render(i === allSteps.length - 1)}</div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

function Step({
  icon: Icon,
  label,
  status,
  children,
}: {
  icon: typeof SearchIcon;
  label: string;
  status: StepStatus;
  isLast?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="pt-3">
      {/* Header — status check + icon + label, all aligned on one line */}
      <div className={cn("flex items-center gap-1.5", status !== 'complete' ? 'mb-2' : '')}>
        <div className="shrink-0">
          {status === "complete" ? (
            <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />
          ) : status === "active" ? (
            <Loader2Icon className="h-4 w-4 animate-spin text-blue-500" />
          ) : (
            <CircleIcon className="h-4 w-4 text-muted-foreground/30" />
          )}
        </div>
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            status === "complete"
              ? "text-foreground/70"
              : status === "active"
                ? "text-blue-500"
                : "text-muted-foreground/40"
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "text-xs font-medium",
            status === "complete"
              ? "text-foreground/80"
              : status === "active"
                ? "text-blue-500"
                : "text-muted-foreground/40"
          )}
        >
          {label}
        </span>
      </div>

      {/* Children — each item gets a dot on a vertical line, aligned under the content icon */}
      {children && (
        <div className="ml-[27px] pt-1">
          {children}
        </div>
      )}
    </div>
  );
}

/** Wraps each child item with a dot + vertical line connector. */
function StepItem({ isLast, children }: { isLast?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <div className="flex flex-col items-center">
        {/* dot centered on the first line of text (leading-4 = 16px, dot at 6px from top) */}
        <div className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
        {!isLast && <div className="w-px flex-1 bg-muted-foreground/25" />}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function ToolCallItem({ call }: { call: ToolCall }) {
  const label = call.query ?? call.name;
  const hasResults = call.resultSummary && call.resultSummary.length > 0;

  if (!hasResults) {
    return (
      <div className="text-xs leading-snug text-muted-foreground">{label}</div>
    );
  }

  return (
    <details className="group/tool">
      <summary className="flex cursor-pointer list-none items-start gap-1 text-xs leading-snug">
        <span className="font-medium text-foreground/70">{label}</span>
        <span className="flex-1 truncate text-muted-foreground">
          — {call.resultSummary!.length} {call.resultSummary!.length === 1 ? "result" : "results"}
        </span>
        <ChevronDownIcon
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform group-open/tool:-rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1 space-y-0.5 pl-1">
        {call.resultSummary!.map((r, j) => (
          <div
            key={j}
            className="truncate text-[10px] text-muted-foreground/70"
          >
            {r}
          </div>
        ))}
      </div>
    </details>
  );
}

function EntryItem({ entry }: { entry: EventedActorsEntry }) {
  if (!entry.body) {
    return (
      <div className="text-xs leading-4 text-muted-foreground">{entry.topic}</div>
    );
  }

  return (
    <details className="group/entry">
      <summary className="flex cursor-pointer list-none items-start gap-1 text-xs leading-4">
        <span className="shrink-0 font-medium text-foreground/70">{entry.topic}</span>
        <span className="flex-1 truncate text-muted-foreground group-open/entry:hidden">
          — {entry.body.slice(0, 80)}...
        </span>
        <ChevronDownIcon
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform group-open/entry:-rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1">
        <EntryMarkdown text={entry.body} />
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const headingComponent = ({ children }: { children?: React.ReactNode }) => (
  <p className="font-semibold">{children}</p>
);

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
      <Markdown
        components={{
          h1: headingComponent,
          h2: headingComponent,
          h3: headingComponent,
          h4: headingComponent,
          h5: headingComponent,
          h6: headingComponent,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
