"use client";

/**
 * Tool calls as background, not content.
 *
 * One call is a single muted line ("Used discover ›") that opens to its input,
 * result and metadata; a run of consecutive calls is one line ("Used 3 tools
 * ›") that opens to one row per call. A call that is running or failed says
 * so in words ("Using discover…", "discover failed"), since there is no badge.
 *
 * This is Shift Manager's own presentation: `flow-state/tool.tsx` is the
 * registry's copy and stays byte-equal to it. {@link shiftManagerRenderers}
 * swaps this in for its `tool_output` renderer.
 */
import { Fragment, type ReactNode } from "react";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import { ChevronRightIcon } from "lucide-react";
import type { RendererRegistry } from "@flow-state-dev/react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { chatAssistantRenderers } from "./flow-state/chat-assistant";
import { ToolInput, ToolOutput } from "./flow-state/tool";

type CallState = "pending" | "running" | "completed" | "error";

function stateOf(status: string): CallState {
  switch (status) {
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    default:
      return "pending";
  }
}

/** The worst state in a run: any failure, else any call still going, else done. */
function runState(items: readonly ToolOutputItem[]): CallState {
  const states = items.map((item) => stateOf(item.status));
  if (states.includes("error")) return "error";
  if (states.some((s) => s === "running" || s === "pending")) return "running";
  return "completed";
}

function argsOf(item: ToolOutputItem): unknown {
  const raw = item.toolCall?.arguments;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** "Used discover", "Using discover…" while it runs, "discover failed" when it did. */
function callLabel(name: string, state: CallState): string {
  if (state === "error") return `${name} failed`;
  if (state === "running" || state === "pending") return `Using ${name}…`;
  return `Used ${name}`;
}

/** The input, result and metadata of one call: what a quiet line opens to. */
function CallDetails({ item }: { item: ToolOutputItem }) {
  const failed = item.status === "failed";
  const args = argsOf(item);
  const output = failed ? undefined : item.output;
  const errorText = failed ? (item.error?.message ?? (item.output === undefined ? undefined : String(item.output))) : undefined;
  const entries: Array<[string, string]> = [];
  if (item.blockName) entries.push(["Block", item.blockName]);
  entries.push(["Item", item.id]);
  return (
    <div className="space-y-3">
      {args !== undefined && <ToolInput input={args} />}
      {item.status !== "in_progress" && (output !== undefined || errorText !== undefined) && <ToolOutput output={output} errorText={errorText} />}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
        {entries.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="uppercase tracking-wide">{k}</dt>
            <dd className="truncate font-mono">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/** The muted line and its chevron, opening to `children`. */
function QuietLine({ label, state, nested = false, children }: { label: string; state: CallState; nested?: boolean; children: ReactNode }) {
  return (
    <Collapsible className="group/quiet not-prose w-full" data-testid={nested ? "tool-row" : "tool-group"} data-state-kind={state}>
      <CollapsibleTrigger className="inline-flex max-w-full items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground">
        <span className={cn("truncate", state === "error" && "text-destructive", nested && "font-mono text-xs")}>{label}</span>
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/quiet:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 ml-1 border-l pl-3 outline-none">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A run of tool calls as one quiet line: the call's own name for one call, a
 * count for several. Opens to the call's details, or to one line per call that
 * opens to its own.
 */
export function ToolLineGroup({ items }: { items: readonly ToolOutputItem[] }) {
  if (items.length === 0) return null;
  const state = runState(items);
  if (items.length === 1) {
    const item = items[0]!;
    return (
      <QuietLine label={callLabel(item.toolCall.name, state)} state={state}>
        <CallDetails item={item} />
      </QuietLine>
    );
  }
  const label = state === "running" ? `Using ${items.length} tools…` : state === "error" ? `Used ${items.length} tools, one failed` : `Used ${items.length} tools`;
  return (
    <QuietLine label={label} state={state}>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <QuietLine label={callLabel(item.toolCall.name, stateOf(item.status))} state={stateOf(item.status)} nested>
              <CallDetails item={item} />
            </QuietLine>
          </li>
        ))}
      </ul>
    </QuietLine>
  );
}

/** One call, as the registry hands it to a `tool_output` renderer. */
export function ToolLine({ item }: { item: ToolOutputItem }) {
  if (!item.toolCall) return null;
  return <ToolLineGroup items={[item]} />;
}

/** The chat registry with tool calls drawn as quiet lines. */
export const shiftManagerRenderers: RendererRegistry = { ...chatAssistantRenderers, tool_output: ToolLine };
