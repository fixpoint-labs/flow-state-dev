"use client";

/**
 * Tool renderers for single tool calls and consecutive tool-call groups.
 */
import type { ComponentProps, ReactNode } from "react";
import type { BlockOutputItem, BlockToolOutputItem } from "@flow-state-dev/core/items";

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
  CircleIcon,
  ClockIcon,
  ListTreeIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { isValidElement } from "react";

import { CodeBlock } from "./code-block";

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
    className={cn("group/tool not-prose mb-2 w-full rounded-md border", className)}
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
  awaiting: <ClockIcon className="size-4 text-yellow-600 dark:text-yellow-400" />,
  completed: <CheckCircleIcon className="size-4 text-green-600 dark:text-green-400" />,
  error: <XCircleIcon className="size-4 text-red-600 dark:text-red-400" />,
  denied: <XCircleIcon className="size-4 text-orange-600 dark:text-orange-400" />,
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
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-180" />
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

export type ToolItem = BlockOutputItem | BlockToolOutputItem;

export function mapToolStatus(status: string): ToolState {
  switch (status) {
    case "in_progress": return "running";
    case "completed": return "completed";
    case "failed": return "error";
    case "incomplete": return "pending";
    default: return "pending";
  }
}

export function getToolName(item: ToolItem): string {
  if (item.type === "block_tool_output") return item.toolCall.name;
  return item.blockName;
}

export function getToolArgs(item: ToolItem): unknown {
  const raw = item.toolCall?.arguments;
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Extract the raw tool payload. `block_tool_output.output` is always raw.
 * `block_output.output` is a BlockValue discriminated union (FIX-413); for
 * tool-call items the generator is a leaf, so we only see the `inline` case.
 */
export function unwrapToolOutput(item: ToolItem): unknown {
  if (item.type === "block_tool_output") return item.output;
  const value = item.output;
  if (value !== undefined && typeof value === "object" && "kind" in value && value.kind === "inline") {
    return (value as { value: unknown }).value;
  }
  return undefined;
}

export function getToolOutput(item: ToolItem): unknown {
  if (item.status === "failed") return undefined;
  return unwrapToolOutput(item);
}

export function getToolErrorText(item: ToolItem): string | undefined {
  if (item.status !== "failed") return undefined;
  if (item.type === "block_tool_output" && item.error) return item.error.message;
  const raw = unwrapToolOutput(item);
  return raw === undefined ? undefined : String(raw);
}

type ToolVerbPhrase = {
  singular: string;
  plural: string;
};

const DEFAULT_TOOL_VERB_PHRASE: ToolVerbPhrase = {
  singular: "ran a tool",
  plural: "ran {count} tools",
};

/**
 * Past-tense summary phrases keyed by tool name.
 * Add aliases here as new tool names should produce richer summaries.
 */
export const TOOL_VERB_PHRASES: Record<string, ToolVerbPhrase> = {
  search: { singular: "ran a search", plural: "ran {count} searches" },
  web_search: { singular: "ran a search", plural: "ran {count} searches" },
  fetch: { singular: "fetched a page", plural: "fetched {count} pages" },
  web_fetch: { singular: "fetched a page", plural: "fetched {count} pages" },
  read_file: { singular: "read a file", plural: "read {count} files" },
  write_file: { singular: "wrote a file", plural: "wrote {count} files" },
  create_file: { singular: "created a file", plural: "created {count} files" },
  update_file: { singular: "updated a file", plural: "updated {count} files" },
  load_tools: { singular: "loaded tools", plural: "loaded tools" },
  bash: { singular: "ran a command", plural: "ran {count} commands" },
};

function capitalizeLabel(label: string): string {
  return label.length === 0 ? label : `${label[0].toUpperCase()}${label.slice(1)}`;
}

function formatToolVerbPhrase(phrase: ToolVerbPhrase, count: number): string {
  return (count === 1 ? phrase.singular : phrase.plural).replace("{count}", String(count));
}

function formatVerbPhrase(name: string, count: number): string | null {
  const phrase = TOOL_VERB_PHRASES[name];
  if (phrase === undefined) return null;
  return formatToolVerbPhrase(phrase, count);
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? "";
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

/**
 * Builds the collapsed group label from a run of consecutive tool calls.
 */
export function getToolGroupSummaryLabel(items: ToolItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = getToolName(item);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  if (counts.size === 0) return "Ran 0 tools";
  if (counts.size > 4) {
    return capitalizeLabel(formatToolVerbPhrase(DEFAULT_TOOL_VERB_PHRASE, items.length));
  }

  const phrases: string[] = [];
  for (const [name, count] of counts) {
    const phrase = formatVerbPhrase(name, count);
    if (phrase === null) {
      return capitalizeLabel(formatToolVerbPhrase(DEFAULT_TOOL_VERB_PHRASE, items.length));
    }
    phrases.push(phrase);
  }

  return capitalizeLabel(joinPhrases(phrases));
}

function getGroupState(items: ToolItem[]): ToolState {
  if (items.some((item) => item.status === "failed")) return "error";
  if (items.some((item) => item.status === "in_progress")) return "running";
  if (items.every((item) => item.status === "completed")) return "completed";
  return "pending";
}

function getToolDuration(item: ToolItem): string {
  const duration = "duration" in item ? item.duration : undefined;
  return typeof duration === "number" ? `${duration}ms` : "Not recorded";
}

function ToolMetadata({ item }: { item: ToolItem }) {
  return (
    <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground sm:grid-cols-2">
      <div><span className="font-medium text-foreground">Duration:</span> {getToolDuration(item)}</div>
      <div><span className="font-medium text-foreground">Block:</span> {item.blockName}</div>
      <div><span className="font-medium text-foreground">Item ID:</span> {item.id}</div>
      <div><span className="font-medium text-foreground">Call ID:</span> {item.toolCall?.callId ?? "Unknown"}</div>
    </div>
  );
}

export function ToolCallRow({ item }: { item: ToolItem }) {
  if (!item.toolCall) return null;
  const state = mapToolStatus(item.status);
  const name = getToolName(item);
  const args = getToolArgs(item);

  return (
    <Collapsible className="group/tool-row rounded-md border bg-background/60">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">{name}</span>
          {getStatusBadge(state)}
        </div>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool-row:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t p-4">
        <ToolInput input={args} />
        {item.status !== "in_progress" && (
          <ToolOutput output={getToolOutput(item)} errorText={getToolErrorText(item)} />
        )}
        <ToolMetadata item={item} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ToolGroup({ items }: { items: ToolItem[] }) {
  if (items.length === 0) return null;
  const state = getGroupState(items);
  const summary = getToolGroupSummaryLabel(items);

  return (
    <Collapsible
      className="group/tool-group not-prose mb-2 w-full overflow-hidden rounded-lg border bg-card/70 shadow-sm"
      defaultOpen={state === "running" || state === "error"}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 p-3 hover:bg-muted/40">
        <div className="flex min-w-0 items-center gap-2">
          <ListTreeIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">{summary}</span>
          <Badge className="rounded-full text-xs" variant="outline">
            {items.length} {items.length === 1 ? "tool" : "tools"}
          </Badge>
          {getStatusBadge(state)}
        </div>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool-group:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t bg-muted/20 p-2">
        {items.map((item) => (
          <ToolCallRow key={item.id} item={item} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Tool({ item }: { item: BlockOutputItem | BlockToolOutputItem }) {
  if (!item.toolCall) return null;
  return (
    <ToolGroup items={[item]} />
  );
}
