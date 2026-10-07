"use client";

/**
 * Tool call rendering for block_trace and tool_output items.
 *
 * Tool calls are background, not content: each one is a single quiet line
 * ("Used discover ›") that opens to its details, and a run of consecutive
 * calls is one line ("Used 3 tools ›") that opens to one row per call.
 *
 *  - <Tool> — one call, as a quiet line.
 *  - <ToolGroup> — a run of `tool_output` items, as one quiet line.
 */

import { Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";
import type { BlockTraceItem, ToolOutputItem } from "@flow-state-dev/core/items";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";

import { CodeBlock } from "./code-block";

export {
  composeToolGroupLabel,
  TOOL_GROUP_DISTINCT_CAP,
  TOOL_VERB_MAP,
  type ToolVerbs,
} from "./tool-grouping";

/**
 * Framework-agnostic tool execution state.
 * Replaces the AI SDK ToolUIPart["state"] with neutral vocabulary.
 */
export type ToolState =
  | "pending"      // not yet started
  | "streaming"    // input being received
  | "running"      // executing
  | "awaiting"     // needs user approval
  | "completed"    // finished successfully
  | "error"        // failed
  | "denied";      // user rejected

export type ToolProps = ComponentProps<typeof Collapsible>;

export const ToolShell = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-2 w-full rounded-md border", className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  name: string;
  state: ToolState;
  title?: string;
  className?: string;
};

const statusLabels: Record<ToolState, string> = {
  pending: "Pending",
  streaming: "Receiving input…",
  running: "Running…",
  awaiting: "Awaiting approval",
  completed: "Completed",
  error: "Error",
  denied: "Denied",
};

const statusIcons: Record<ToolState, ReactNode> = {
  pending: <CircleIcon className="size-4" />,
  streaming: <ClockIcon className="size-4 animate-pulse" />,
  running: <ClockIcon className="size-4 animate-pulse" />,
  awaiting: <ClockIcon className="size-4 text-attention" />,
  completed: <CheckCircleIcon className="size-4 text-success" />,
  error: <XCircleIcon className="size-4 text-destructive" />,
  denied: <XCircleIcon className="size-4 text-warning" />,
};

export const getStatusBadge = (state: ToolState) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[state]}
    {statusLabels[state]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  name,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center justify-between gap-4 p-3",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">{title ?? name}</span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output?: unknown;
  errorText?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};

type ToolItem = BlockTraceItem | ToolOutputItem;

function mapToolStatus(status: string): ToolState {
  switch (status) {
    case "in_progress": return "running";
    case "completed": return "completed";
    case "failed": return "error";
    case "incomplete": return "pending";
    default: return "pending";
  }
}

function getToolName(item: ToolItem): string {
  if (item.type === "tool_output") return item.toolCall.name;
  return item.blockName;
}

function getToolArgs(item: ToolItem): unknown {
  const raw = item.toolCall?.arguments;
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Extract the raw tool payload. `tool_output.output` is always raw.
 * `block_trace.output` is a BlockValue discriminated union (FIX-413); for
 * tool-call items the generator is a leaf, so we only see the `inline` case.
 */
function unwrapToolOutput(item: ToolItem): unknown {
  if (item.type === "tool_output") return item.output;
  const value = item.output;
  if (value !== undefined && typeof value === "object" && "kind" in value && value.kind === "inline") {
    return (value as { value: unknown }).value;
  }
  return undefined;
}

function getToolOutput(item: ToolItem): unknown {
  if (item.status === "failed") return undefined;
  return unwrapToolOutput(item);
}

function getToolErrorText(item: ToolItem): string | undefined {
  if (item.status !== "failed") return undefined;
  if (item.type === "tool_output" && item.error) return item.error.message;
  const raw = unwrapToolOutput(item);
  return raw === undefined ? undefined : String(raw);
}

/** The input, result and metadata of one call: what a quiet line opens to. */
function ToolDetails({ item }: { item: ToolItem }) {
  const args = getToolArgs(item);
  const output = getToolOutput(item);
  const errorText = getToolErrorText(item);
  return (
    <div className="space-y-3">
      {args !== undefined && <ToolInput input={args} />}
      {item.status !== "in_progress" && (output !== undefined || errorText !== undefined) && (
        <ToolOutput output={output} errorText={errorText} />
      )}
      <ToolRowMetadata item={item} />
    </div>
  );
}

/**
 * The quiet line every tool presentation shares: muted text and a chevron,
 * opening to `children`. A call that is running or failed says so in words
 * ("Using discover…", "discover failed"), since there is no badge.
 */
function QuietToolLine({ label, state, children }: { label: string; state: ToolState; children: ReactNode }) {
  return (
    <Collapsible className="group/quiet not-prose w-full" data-testid="tool-group" data-state-kind={state}>
      <CollapsibleTrigger className="inline-flex max-w-full items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground">
        <span className={cn("truncate", state === "error" && "text-destructive")}>{label}</span>
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/quiet:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 ml-1 border-l pl-3 outline-none">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** "Used discover", "Using discover…" while it runs, "discover failed" when it did. */
function callLabel(name: string, state: ToolState): string {
  if (state === "error") return `${name} failed`;
  if (state === "running" || state === "streaming" || state === "pending") return `Using ${name}…`;
  return `Used ${name}`;
}

export function Tool({ item }: { item: BlockTraceItem | ToolOutputItem }) {
  if (!item.toolCall) return null;
  const state = mapToolStatus(item.status);
  return (
    <QuietToolLine label={callLabel(getToolName(item), state)} state={state}>
      <ToolDetails item={item} />
    </QuietToolLine>
  );
}

// ---------------------------------------------------------------------------
// <ToolGroup> / <ToolRow> — Level-1 / Level-2 rendering.
// ---------------------------------------------------------------------------

/** Worst status in a batch, used to color the group summary. */
function aggregateGroupState(items: ToolOutputItem[]): ToolState {
  let hasError = false;
  let hasRunning = false;
  for (const item of items) {
    const state = mapToolStatus(item.status);
    if (state === "error") hasError = true;
    else if (state === "running" || state === "streaming" || state === "pending") hasRunning = true;
  }
  if (hasError) return "error";
  if (hasRunning) return "running";
  return "completed";
}

export type ToolGroupProps = {
  items: ToolOutputItem[];
  /** Default-open state. Defaults to false (collapsed). */
  defaultOpen?: boolean;
  className?: string;
};

/**
 * A run of tool calls as one quiet line: the call's own name for one call
 * ("Used discover"), a count for several ("Used 3 tools"). Opens to the
 * call's details, or to one row per call that opens to its own.
 */
export function ToolGroup({ items }: ToolGroupProps) {
  if (items.length === 0) return null;
  const state = aggregateGroupState(items);
  if (items.length === 1) {
    const item = items[0]!;
    return (
      <QuietToolLine label={callLabel(item.toolCall.name, state)} state={state}>
        <ToolDetails item={item} />
      </QuietToolLine>
    );
  }
  const label = state === "running" ? `Using ${items.length} tools…` : state === "error" ? `Used ${items.length} tools, one failed` : `Used ${items.length} tools`;
  return (
    <QuietToolLine label={label} state={state}>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <ToolRow item={item} />
          </li>
        ))}
      </ul>
    </QuietToolLine>
  );
}

export type ToolRowProps = {
  item: ToolOutputItem;
  defaultOpen?: boolean;
  className?: string;
};

/**
 * Level-2 individual tool call row — a compact, independently collapsible
 * line that expands to the Level-3 detail (input args, output, metadata).
 */
export function ToolRow({ item, defaultOpen = false, className }: ToolRowProps) {
  const state = mapToolStatus(item.status);
  const name = item.toolCall.name;
  const args = getToolArgs(item);
  const output = getToolOutput(item);
  const errorText = getToolErrorText(item);

  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("group/row", className)}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40">
        <div className="flex min-w-0 items-center gap-2">
          <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs">{name}</span>
          <ToolRowStatus state={state} />
        </div>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/row:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pt-2 pb-3">
        {args !== undefined && <ToolInput input={args} />}
        {item.status !== "in_progress" && (output !== undefined || errorText !== undefined) && (
          <ToolOutput output={output} errorText={errorText} />
        )}
        <ToolRowMetadata item={item} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolRowStatus({ state }: { state: ToolState }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs">
      {statusIcons[state]}
      <span>{statusLabels[state]}</span>
    </span>
  );
}

function ToolRowMetadata({ item }: { item: ToolItem }) {
  const entries: Array<[string, string]> = [];
  if (item.blockName) entries.push(["Block", item.blockName]);
  entries.push(["Item", item.id]);

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="uppercase tracking-wide">{k}</dt>
          <dd className="truncate font-mono">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
