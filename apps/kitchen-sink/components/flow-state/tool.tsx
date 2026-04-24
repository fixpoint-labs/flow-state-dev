"use client";

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
    className={cn("group/tool not-prose w-full rounded-md border", className)}
    {...props}
  />
);

export type ToolGroupProps = ComponentProps<typeof Collapsible> & {
  items: ToolItem[];
};

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
  awaiting: <ClockIcon className="size-4 text-yellow-600" />,
  completed: <CheckCircleIcon className="size-4 text-green-600" />,
  error: <XCircleIcon className="size-4 text-red-600" />,
  denied: <XCircleIcon className="size-4 text-orange-600" />,
};

export const getStatusBadge = (state: ToolState) => (
  <Badge
    className={cn(
      "gap-1.5 rounded-full border text-xs",
      state === "completed" && "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
      state === "error" && "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
      state === "running" && "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
    )}
    variant="secondary"
  >
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

type ToolItem = BlockOutputItem | BlockToolOutputItem;

type ToolVerbPhrase = {
  singular: string;
  plural: string;
};

/**
 * Data-driven phrase registry used for group summary labels.
 * Add aliases here when new tool names need a more specific phrase.
 */
export const TOOL_VERB_PHRASES: Record<string, ToolVerbPhrase> = {
  web_search: { singular: "ran a search", plural: "ran {count} searches" },
  search: { singular: "ran a search", plural: "ran {count} searches" },
  fetch: { singular: "fetched a page", plural: "fetched {count} pages" },
  web_fetch: { singular: "fetched a page", plural: "fetched {count} pages" },
  read_file: { singular: "read a file", plural: "read {count} files" },
  write_file: { singular: "wrote a file", plural: "wrote {count} files" },
  create_file: { singular: "created a file", plural: "created {count} files" },
  update_file: { singular: "updated a file", plural: "updated {count} files" },
  edit_file: { singular: "edited a file", plural: "edited {count} files" },
  load_tools: { singular: "loaded tools", plural: "loaded tools" },
  bash: { singular: "ran a command", plural: "ran {count} commands" },
  shell: { singular: "ran a command", plural: "ran {count} commands" },
};

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
  if (item.type === "block_tool_output") return item.toolCall.name;
  return item.blockName;
}

function getToolArgs(item: ToolItem): unknown {
  const raw = item.toolCall?.arguments;
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Extract the raw tool payload. `block_tool_output.output` is always raw.
 * `block_output.output` is a BlockValue discriminated union (FIX-413); for
 * tool-call items the generator is a leaf, so we only see the `inline` case.
 */
function unwrapToolOutput(item: ToolItem): unknown {
  if (item.type === "block_tool_output") return item.output;
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
  if (item.type === "block_tool_output" && item.error) return item.error.message;
  const raw = unwrapToolOutput(item);
  return raw === undefined ? undefined : String(raw);
}

function formatPhrase(phrase: ToolVerbPhrase, count: number): string {
  return count === 1
    ? phrase.singular
    : phrase.plural.replace("{count}", String(count));
}

function formatList(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function getGroupState(items: ToolItem[]): ToolState {
  if (items.some((item) => item.status === "in_progress")) return "running";
  if (items.some((item) => item.status === "failed")) return "error";
  return "completed";
}

/**
 * Builds the natural-language summary for a consecutive tool-call group.
 * Unknown tool names intentionally collapse to the generic phrase.
 */
export function getToolGroupSummary(items: ToolItem[]): string {
  const counts = new Map<string, number>();
  let hasUnknown = false;

  for (const item of items) {
    const toolName = getToolName(item);
    const phrase = TOOL_VERB_PHRASES[toolName];
    if (phrase === undefined) {
      hasUnknown = true;
    }
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
  }

  if (hasUnknown || counts.size > 4) {
    return `Ran ${items.length} ${items.length === 1 ? "tool" : "tools"}`;
  }

  const phrases = [...counts].map(([toolName, count]) =>
    formatPhrase(TOOL_VERB_PHRASES[toolName], count)
  );

  return capitalizeFirst(formatList(phrases));
}

export function Tool({ item }: { item: BlockOutputItem | BlockToolOutputItem }) {
  if (!item.toolCall) return null;
  return (
    <ToolGroup items={[item]} />
  );
}

function ToolMetadata({ item }: { item: ToolItem }) {
  const metadata = [
    ["Block", item.blockName],
    ["Item ID", item.id],
    ["Duration", "duration" in item && item.duration !== undefined ? `${item.duration}ms` : undefined],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined);

  if (metadata.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Metadata
      </h4>
      <dl className="grid gap-1 rounded-md bg-muted/30 p-3 text-xs">
        {metadata.map(([label, value]) => (
          <div className="grid grid-cols-[5rem_1fr] gap-2" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all font-mono text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ToolCallRow({ item }: { item: ToolItem }) {
  if (!item.toolCall) return null;
  const state = mapToolStatus(item.status);
  const name = getToolName(item);
  const args = getToolArgs(item);

  return (
    <ToolShell className="bg-background/60">
      <ToolHeader name={name} state={state} />
      <ToolContent>
        <ToolInput input={args} />
        {item.status !== "in_progress" && (
          <ToolOutput output={getToolOutput(item)} errorText={getToolErrorText(item)} />
        )}
        <ToolMetadata item={item} />
      </ToolContent>
    </ToolShell>
  );
}

export function ToolGroup({ items, className, ...props }: ToolGroupProps) {
  if (items.length === 0) return null;
  const state = getGroupState(items);
  return (
    <Collapsible
      className={cn(
        "group/tool-group not-prose w-full overflow-hidden rounded-xl border border-border/70 bg-card/70 shadow-sm",
        className
      )}
      {...props}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-muted/40">
        <div className="flex min-w-0 items-center gap-2">
          <ListTreeIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">{getToolGroupSummary(items)}</span>
          <Badge className="rounded-full text-xs" variant="outline">
            {items.length}
          </Badge>
          {getStatusBadge(state)}
        </div>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool-group:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t bg-background/40 p-2">
        <div className="space-y-2">
          {items.map((item) => (
            <ToolCallRow key={item.id} item={item} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
