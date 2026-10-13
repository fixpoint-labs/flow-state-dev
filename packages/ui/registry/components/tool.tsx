"use client";

/**
 * Tool call rendering for block_trace and tool_output items.
 *
 * Tool calls are background, not content. Each presentation is a single
 * muted line with a chevron that opens to the details:
 *
 *  - <Tool> — one call, as the renderer registry hands it to a
 *    `tool_output` renderer.
 *
 *  - <ToolGroup> — a run of consecutive calls as one line, labelled from
 *    what each call said it was doing ("List files · Run tests"), opening
 *    to one line per call that opens to its input, result and metadata.
 *
 * A call's label is its stated intent when its tool carries one (Bash's
 * `description`), otherwise the name-based phrase ("Ran a search"). There
 * is no status badge: a running call ends in "…", a failed one says so
 * and turns destructive.
 *
 * Consecutive `tool_output` items in the chat stream are wrapped in a
 * <ToolGroup> via ItemsRenderer's `toolGroupRenderer`.
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
  ChevronRightIcon,
  CircleIcon,
  ClockIcon,
  XCircleIcon,
} from "lucide-react";

import { CodeBlock } from "./code-block";
import { composeToolCallsLabel, toolIntent } from "./tool-grouping";

export {
  composeToolCallsLabel,
  composeToolGroupLabel,
  toolIntent,
  TOOL_GROUP_DISTINCT_CAP,
  TOOL_GROUP_INTENT_CAP,
  TOOL_INTENT_ARG,
  TOOL_VERB_MAP,
  type ToolCallLabelInput,
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
  awaiting: <ClockIcon className="size-4 bg-attention text-attention-foreground" />,
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

/** A call's (or a run's) state, reduced to what a quiet line says in words. */
type LineState = "running" | "completed" | "error";

function lineState(status: string): LineState {
  const state = mapToolStatus(status);
  if (state === "error") return "error";
  if (state === "completed") return "completed";
  return "running";
}

/** The worst state in a run: any failure, else any call still going, else done. */
function runState(items: readonly ToolItem[]): LineState {
  const states = items.map((item) => lineState(item.status));
  if (states.includes("error")) return "error";
  if (states.includes("running")) return "running";
  return "completed";
}

function labelInput(item: ToolItem) {
  const name = getToolName(item);
  return { name, intent: toolIntent(name, getToolArgs(item)) };
}

/** The input, result and metadata of one call: what its line opens to. */
function ToolCallDetails({ item }: { item: ToolItem }) {
  const args = getToolArgs(item);
  const output = getToolOutput(item);
  const errorText = getToolErrorText(item);
  const entries: Array<[string, string]> = [];
  if (item.blockName) entries.push(["Block", item.blockName]);
  entries.push(["Item", item.id]);

  return (
    <div className="space-y-3">
      {args !== undefined && <ToolInput input={args} />}
      {item.status !== "in_progress" && (output !== undefined || errorText !== undefined) && (
        <ToolOutput output={output} errorText={errorText} />
      )}
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

type ToolLineProps = {
  label: string;
  state: LineState;
  /** Set on a per-call line inside a group; a name-only label renders mono. */
  nested?: boolean;
  mono?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
};

/** The muted line and its chevron, opening to `children`. */
function ToolLine({ label, state, nested = false, mono = false, defaultOpen = false, className, children }: ToolLineProps) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      data-testid={nested ? "tool-row" : "tool-group"}
      data-state-kind={state}
      // Named apart, so an open group doesn't turn its closed rows' chevrons.
      className={cn("not-prose w-full", nested ? "group/tool-row" : "group/tool mb-2", className)}
    >
      <CollapsibleTrigger className="inline-flex max-w-full items-center gap-1 text-left text-muted-foreground text-sm hover:text-foreground">
        <span className={cn("truncate", state === "error" && "text-destructive", mono && "font-mono text-xs")}>
          {label}
        </span>
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            nested ? "group-data-[state=open]/tool-row:rotate-90" : "group-data-[state=open]/tool:rotate-90"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 ml-1 border-l pl-3 outline-none">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** "List files", "List files…" while it runs, "List files (failed)" when it did. */
function withState(label: string, state: LineState, failed = 0, total = 1): string {
  if (state === "running") return `${label}…`;
  if (state === "error") return total > 1 ? `${label} (${failed} failed)` : `${label} (failed)`;
  return label;
}

/** One tool call as a quiet line that opens to its details. */
export function Tool({ item }: { item: BlockTraceItem | ToolOutputItem }) {
  if (!item.toolCall) return null;
  const state = lineState(item.status);
  return (
    <ToolLine label={withState(composeToolCallsLabel([labelInput(item)]), state)} state={state}>
      <ToolCallDetails item={item} />
    </ToolLine>
  );
}

export type ToolGroupProps = {
  items: ToolOutputItem[];
  /** Default-open state. Defaults to false (collapsed). */
  defaultOpen?: boolean;
  className?: string;
};

/**
 * A run of tool calls as one quiet line. One call opens straight to its
 * details; several open to one line per call. While the run is going the
 * line names the call in flight, so it reads as the agent's current step.
 */
export function ToolGroup({ items, defaultOpen = false, className }: ToolGroupProps) {
  if (items.length === 0) return null;

  const state = runState(items);
  const inputs = items.map(labelInput);

  if (items.length === 1) {
    const item = items[0]!;
    return (
      <ToolLine
        label={withState(composeToolCallsLabel(inputs), state)}
        state={state}
        defaultOpen={defaultOpen}
        className={className}
      >
        <ToolCallDetails item={item} />
      </ToolLine>
    );
  }

  const failed = items.filter((item) => lineState(item.status) === "error").length;
  let current = -1;
  if (state === "running") {
    for (let i = items.length - 1; i >= 0; i--) {
      if (lineState(items[i]!.status) === "running") { current = i; break; }
    }
  }
  const label =
    current >= 0
      ? withState(composeToolCallsLabel([inputs[current]!]), "running")
      : withState(composeToolCallsLabel(inputs), state, failed, items.length);

  return (
    <ToolLine label={label} state={state} defaultOpen={defaultOpen} className={className}>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={item.id}>
            <ToolRow item={item} intent={inputs[i]!.intent} />
          </li>
        ))}
      </ul>
    </ToolLine>
  );
}

export type ToolRowProps = {
  item: ToolOutputItem;
  /** The call's stated intent, when the caller already parsed it. */
  intent?: string;
  defaultOpen?: boolean;
  className?: string;
};

/**
 * One call inside an open group: its intent, or its tool name in mono when
 * it stated none, opening to the call's input, result and metadata.
 */
export function ToolRow({ item, intent, defaultOpen = false, className }: ToolRowProps) {
  const state = lineState(item.status);
  const stated = intent ?? labelInput(item).intent;
  return (
    <ToolLine
      label={withState(stated ?? item.toolCall.name, state)}
      state={state}
      nested
      mono={stated === undefined}
      defaultOpen={defaultOpen}
      className={className}
    >
      <ToolCallDetails item={item} />
    </ToolLine>
  );
}
