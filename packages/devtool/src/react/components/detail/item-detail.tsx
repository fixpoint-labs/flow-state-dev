/**
 * Contextual detail sidebar for the selected item.
 *
 * Layout adapts per item type:
 * - Messages: content breakdown, role, token hint.
 * - Block outputs: full I/O JSON, model usage, tool call metadata, provenance.
 * - State/resource changes: scope, operation, delta.
 * - Containers: child info, block kind.
 *
 * Provenance is always available in a collapsible section.
 */
import { useState } from "react";
import { Copy, ChevronDown, ChevronRight } from "lucide-react";
import type { BlockTraceItem, OutputItem } from "@flow-state-dev/core/items";

// Generator config + connected-input view used by DebugPayloadSection.
// Sourced directly from `block_trace.generator` and `block_trace.input.connected`.
type BlockDebugPayload = {
  model?: string;
  prompt?: string;
  tools?: string[];
  user?: unknown[];
  history?: unknown[];
  connectedInput?: unknown;
  modelOutput?: string;
};
import type { DevtoolItem } from "../../lib/item-types";
import { Button } from "../ui/button";
import { useSelection } from "../../context/selection-context";
import { StatusBadge } from "../shared/status-badge";
import { JsonViewer } from "../shared/json-viewer";
import { BlockValueView, ToolOutputView } from "../shared/block-value-view";
import { EmptyState } from "../shared/empty-state";
import { SequencerStateSection } from "./sequencer-state-panel";
import { safeParseJson } from "../../lib/utils";
import type { TraceNode } from "../../lib/trace-tree";

export function ItemDetail() {
  const { selection, selectedItem, selectedStateSnapshots, selectedBlockNode } = useSelection();

  if (selection === null) {
    return (
      <EmptyState message="Select a block or item to inspect." className="h-full" />
    );
  }

  if (selection.kind === "block" && selectedBlockNode) {
    return <BlockNodeDetail node={selectedBlockNode} />;
  }

  if (selectedItem) {
    return <ItemDetailContent item={selectedItem} stateSnapshots={selectedStateSnapshots} />;
  }

  return null;
}

/**
 * Block-level detail sidebar. Composes every observability surface attached
 * to the selected block into one panel so users don't hunt through sibling
 * rows for debug payload / state timeline / final output.
 */
function BlockNodeDetail({ node }: { node: TraceNode }) {
  const traceItem = node.traceItem as BlockTraceItem | undefined;
  const generator = traceItem?.generator;
  const connectedInput = traceItem?.input?.connected;
  const debugPayload: BlockDebugPayload | undefined =
    generator !== undefined || connectedInput !== undefined
      ? {
          ...(generator ?? {}),
          ...(connectedInput !== undefined ? { connectedInput } : {}),
        }
      : undefined;

  const handleCopy = () => {
    const payload = {
      block: {
        name: node.blockName,
        kind: node.blockKind,
        instanceId: node.blockInstanceId,
        status: node.blockStatus,
        durationMs: node.blockDuration,
      },
      debug: debugPayload,
      stateSnapshots: node.stateSnapshots,
      output: traceItem?.output,
      error: traceItem?.error,
    };
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  };

  const prompt = debugPayload?.prompt;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase text-slate-500">Block</span>
          <span className="text-[10px] font-mono px-1.5 py-0 rounded border border-slate-700 text-slate-300">
            {node.blockKind ?? "?"}
          </span>
          <span className="text-xs text-slate-200 font-mono">{node.blockName}</span>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={handleCopy} title="Copy block detail">
          <Copy className="h-3 w-3 text-slate-500" />
        </Button>
      </div>

      {node.blockStatus && (
        <div className="flex items-center gap-2">
          <StatusBadge status={node.blockStatus} />
          {node.blockDuration !== undefined && (
            <span className="text-[10px] font-mono text-slate-500">{node.blockDuration}ms</span>
          )}
        </div>
      )}

      {traceItem?.status === "failed" && traceItem.error && (
        <div className="rounded bg-red-950/30 border border-red-800/50 px-3 py-2">
          <span className="text-[10px] uppercase text-red-400 font-medium">Error</span>
          <p className="text-xs text-red-300 mt-0.5 font-mono">{traceItem.error.message}</p>
          {traceItem.error.code && (
            <p className="text-[10px] text-red-400/60 mt-0.5 font-mono">{traceItem.error.code}</p>
          )}
        </div>
      )}

      {/* Prompt — the #1 thing you want to see for generators */}
      {prompt && (
        <CollapsibleSection title="Prompt" defaultOpen>
          <pre className="text-[11px] text-slate-300 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
            {prompt}
          </pre>
        </CollapsibleSection>
      )}

      {/* User message(s) for this turn — what the caller actually sent in */}
      {debugPayload?.user && debugPayload.user.length > 0 && (
        <CollapsibleSection
          title={`User Message${debugPayload.user.length > 1 ? `s (${debugPayload.user.length})` : ""}`}
          defaultOpen
        >
          <MessageList messages={debugPayload.user} />
        </CollapsibleSection>
      )}

      {/* Conversation history sent alongside the user message */}
      {debugPayload?.history && debugPayload.history.length > 0 && (
        <CollapsibleSection
          title={`History (${debugPayload.history.length})`}
          defaultOpen={false}
        >
          <MessageList messages={debugPayload.history} />
        </CollapsibleSection>
      )}

      {/* Resolved generator config */}
      {debugPayload && <DebugPayloadSection payload={debugPayload} />}

      {/* State snapshots timeline (sequencers) */}
      {node.stateSnapshots && node.stateSnapshots.length > 0 && (
        <SequencerStateSection snapshots={node.stateSnapshots} />
      )}

      {/* Output — collapsed by default, output blobs can be large */}
      {traceItem?.output !== undefined && (
        <CollapsibleSection title="Output" defaultOpen={false}>
          <BlockValueView value={traceItem.output} />
        </CollapsibleSection>
      )}

      {/* Model usage for generators */}
      {traceItem?.modelUsage && (
        <CollapsibleSection title="Model Usage" defaultOpen={false}>
          <div className="space-y-1">
            {traceItem.modelUsage.model && <MetadataRow label="Model" value={traceItem.modelUsage.model} />}
            {traceItem.modelUsage.promptTokens !== undefined && <MetadataRow label="Prompt tokens" value={String(traceItem.modelUsage.promptTokens)} />}
            {traceItem.modelUsage.completionTokens !== undefined && <MetadataRow label="Completion tokens" value={String(traceItem.modelUsage.completionTokens)} />}
            {traceItem.modelUsage.cacheReadTokens !== undefined && <MetadataRow label="Cache read" value={String(traceItem.modelUsage.cacheReadTokens)} />}
          </div>
        </CollapsibleSection>
      )}

      {/* Identity */}
      <CollapsibleSection title="Identity" defaultOpen={false}>
        <div className="space-y-1">
          {node.blockInstanceId && <MetadataRow label="Instance" value={node.blockInstanceId} mono />}
          {node.blockKind && <MetadataRow label="Kind" value={node.blockKind} />}
          {node.blockStartedAt !== undefined && (
            <MetadataRow label="Started" value={new Date(node.blockStartedAt).toISOString().slice(11, 23)} mono />
          )}
          {node.blockCompletedAt !== undefined && (
            <MetadataRow label="Completed" value={new Date(node.blockCompletedAt).toISOString().slice(11, 23)} mono />
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}

/**
 * Renders an array of generator messages (user-slot or history) as compact
 * role-tagged bubbles. String content is shown inline; everything else falls
 * through to the JsonViewer so unusual shapes (multi-part content, tool
 * calls/results in history) stay inspectable without losing fidelity.
 */
function MessageList({ messages }: { messages: unknown[] }) {
  return (
    <div className="space-y-2">
      {messages.map((msg, i) => (
        <MessageRow key={i} message={msg} />
      ))}
    </div>
  );
}

function MessageRow({ message }: { message: unknown }) {
  const role = isObject(message) && typeof message.role === "string" ? message.role : null;
  const content = isObject(message) ? message.content : undefined;
  const badge = classifyMessageBadge(role, content);

  return (
    <div className="rounded border border-slate-800 bg-slate-950/50 p-2">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] uppercase font-medium font-mono px-1.5 py-0 rounded border ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      {typeof content === "string" ? (
        <pre className="text-[11px] text-slate-300 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
          {content}
        </pre>
      ) : (
        <JsonViewer data={role ? content : message} />
      )}
    </div>
  );
}

/**
 * Pick the badge label/color from message shape. Pure tool-call payloads
 * (assistant role, content is only `tool-call` parts) read as "TOOL CALL"
 * rather than ASSISTANT — the role describes who emitted it on the wire,
 * but for debug viewing the payload kind is what the reader cares about.
 * Mixed assistant content (text + tool-call) keeps the ASSISTANT badge
 * since the prose is the user-visible part.
 */
function classifyMessageBadge(
  role: string | null,
  content: unknown
): { label: string; className: string } {
  const partTypes = collectContentPartTypes(content);
  if (partTypes && partTypes.size > 0) {
    if (partTypes.size === 1 && partTypes.has("tool-call")) {
      return { label: "tool call", className: TOOL_CALL_BADGE };
    }
    if (partTypes.size === 1 && partTypes.has("tool-result")) {
      return { label: "tool result", className: TOOL_RESULT_BADGE };
    }
  }
  return {
    label: role ?? "msg",
    className: role
      ? ROLE_BADGE_COLORS[role] ?? "border-slate-700 text-slate-400"
      : "border-slate-700 text-slate-500",
  };
}

function collectContentPartTypes(content: unknown): Set<string> | null {
  if (!Array.isArray(content)) return null;
  const types = new Set<string>();
  for (const part of content) {
    if (isObject(part) && typeof part.type === "string") types.add(part.type);
  }
  return types;
}

const TOOL_CALL_BADGE = "border-purple-700/60 text-purple-300";
const TOOL_RESULT_BADGE = "border-fuchsia-700/60 text-fuchsia-300";

const ROLE_BADGE_COLORS: Record<string, string> = {
  user: "border-sky-700/60 text-sky-300",
  assistant: "border-emerald-700/60 text-emerald-300",
  system: "border-amber-700/60 text-amber-300",
  tool: TOOL_RESULT_BADGE,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function DebugPayloadSection({ payload }: { payload: BlockDebugPayload }) {
  const hasConfig = payload.model || (payload.tools && payload.tools.length > 0);
  const hasConnected = payload.connectedInput !== undefined;
  const hasModelOutput = payload.modelOutput !== undefined;
  if (!hasConfig && !hasConnected && !hasModelOutput) return null;
  return (
    <>
      {hasConfig && (
        <CollapsibleSection title="Resolved Config" defaultOpen={false}>
          <div className="space-y-1">
            {payload.model && <MetadataRow label="Model" value={payload.model} mono />}
            {payload.tools && payload.tools.length > 0 && (
              <div>
                <span className="text-[10px] text-slate-600 uppercase">Tools ({payload.tools.length})</span>
                <div className="mt-0.5 space-y-0.5">
                  {payload.tools.map((name) => (
                    <div key={name} className="text-[11px] text-slate-300 font-mono">{name}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}
      {hasConnected && (
        <CollapsibleSection title="Connected Input" defaultOpen>
          <JsonViewer data={payload.connectedInput} />
        </CollapsibleSection>
      )}
      {hasModelOutput && (
        <CollapsibleSection title="Model-visible Output" defaultOpen>
          <pre className="text-[11px] text-amber-200 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
            {payload.modelOutput}
          </pre>
        </CollapsibleSection>
      )}
    </>
  );
}

function ItemDetailContent({ item, stateSnapshots }: { item: DevtoolItem; stateSnapshots: import("../../lib/trace-tree").StateSnapshot[] | null }) {
  const handleCopy = () => {
    void navigator.clipboard.writeText(JSON.stringify(item, null, 2));
  };

  const isSequencerBlock =
    item.type === "block_trace" && item.blockKind === "sequencer";

  return (
    <div className="space-y-3 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase text-slate-500">Detail</span>
          <TypePill type={item.type} />
        </div>
        <Button variant="ghost" size="icon-xs" onClick={handleCopy} title="Copy raw JSON">
          <Copy className="h-3 w-3 text-slate-500" />
        </Button>
      </div>

      {/* Type-specific content */}
      <ItemTypeDetail item={item} />

      {/* Sequencer state inspector — shown for sequencer blocks with state */}
      {isSequencerBlock && stateSnapshots && stateSnapshots.length > 0 && (
        <SequencerStateSection snapshots={stateSnapshots} />
      )}

      {/* Provenance (collapsible) */}
      <CollapsibleSection title="Provenance" defaultOpen={false}>
        <div className="space-y-1">
          <MetadataRow label="Block" value={item.provenance.blockName} />
          <MetadataRow label="Instance" value={item.provenance.blockInstanceId} mono />
          {item.provenance.parentBlockInstanceId && (
            <MetadataRow label="Parent" value={item.provenance.parentBlockInstanceId} mono />
          )}
          <MetadataRow label="Phase" value={item.provenance.phase} />
          {item.provenance.stepIndex !== undefined && (
            <MetadataRow label="Step" value={String(item.provenance.stepIndex)} />
          )}
          {item.provenance.attempt !== undefined && (
            <MetadataRow label="Attempt" value={String(item.provenance.attempt)} />
          )}
          <MetadataRow label="Item Index" value={String(item.itemIndex)} />
          <MetadataRow label="Status">
            <StatusBadge status={item.status} />
          </MetadataRow>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function ItemTypeDetail({ item }: { item: DevtoolItem }) {
  switch (item.type) {
    case "message":
      return <MessageDetail item={item} />;
    case "block_trace":
      return <BlockOutputDetail item={item} />;
    case "error":
      return <ErrorDetail item={item} />;
    case "reasoning":
      return <ReasoningDetail item={item} />;
    case "component":
      return <ComponentDetail item={item} />;
    case "container":
      return <ContainerDetail item={item} />;
    case "state_change":
      return <StateChangeDetail item={item} />;
    case "resource_change":
      return <ResourceChangeDetail item={item} />;
    case "status":
      return <StatusDetail item={item} />;
    case "tool_output":
      return <BlockToolOutputDetail item={item} />;
    case "router_decision":
      return <RouterDecisionDetail item={item} />;
    case "source":
      return <SourceDetail item={item} />;
    case "state_snapshot":
      return <StateSnapshotDetail item={item} />;
    default:
      return <JsonViewer data={item} />;
  }
}

/* --- Per-type detail sections --- */

function MessageDetail({ item }: { item: DevtoolItem & { type: "message" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Role" value={item.role} />
      <CollapsibleSection title="Content" defaultOpen>
        {item.content.map((part, i) => (
          <div key={i} className="mb-1.5">
            <span className="text-[10px] text-slate-600 uppercase">{part.type}</span>
            {"text" in part && (
              <p className="text-xs text-slate-300 whitespace-pre-wrap mt-0.5">{part.text}</p>
            )}
          </div>
        ))}
      </CollapsibleSection>
    </div>
  );
}

function BlockOutputDetail({ item }: { item: DevtoolItem & { type: "block_trace" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Block" value={item.blockName} mono />
      {item.status === "failed" && item.error && (
        <div className="rounded bg-red-950/30 border border-red-800/50 px-3 py-2">
          <span className="text-[10px] uppercase text-red-400 font-medium">Error</span>
          <p className="text-xs text-red-300 mt-0.5 font-mono">{item.error.message}</p>
          {item.error.code && (
            <p className="text-[10px] text-red-400/60 mt-0.5 font-mono">{item.error.code}</p>
          )}
        </div>
      )}
      {item.toolCall && (
        <CollapsibleSection title="Tool Call" defaultOpen>
          <MetadataRow label="Call ID" value={item.toolCall.callId} mono />
          <MetadataRow label="Generator" value={item.toolCall.generatorBlock} />
          <div className="mt-1">
            <span className="text-[10px] text-slate-600 uppercase">Arguments</span>
            <JsonViewer data={safeParseJson(item.toolCall.arguments)} className="mt-0.5" />
          </div>
        </CollapsibleSection>
      )}
      {item.output !== undefined && (
        <CollapsibleSection title="Output" defaultOpen>
          <BlockValueView value={item.output} />
        </CollapsibleSection>
      )}
      {item.modelUsage && (
        <CollapsibleSection title="Model Usage" defaultOpen>
          <div className="space-y-1">
            {item.modelUsage.model && <MetadataRow label="Model" value={item.modelUsage.model} />}
            {item.modelUsage.promptTokens !== undefined && <MetadataRow label="Prompt tokens" value={String(item.modelUsage.promptTokens)} />}
            {item.modelUsage.completionTokens !== undefined && <MetadataRow label="Completion tokens" value={String(item.modelUsage.completionTokens)} />}
            {item.modelUsage.cacheReadTokens !== undefined && <MetadataRow label="Cache read" value={String(item.modelUsage.cacheReadTokens)} />}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

function ErrorDetail({ item }: { item: DevtoolItem & { type: "error" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Message" value={item.message} />
      {item.code && <MetadataRow label="Code" value={item.code} mono />}
    </div>
  );
}

function ReasoningDetail({ item }: { item: DevtoolItem & { type: "reasoning" } }) {
  const text = item.summary.map((c) => ("text" in c ? (c as { text: string }).text : "")).join("");
  return (
    <div>
      <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  );
}

function ComponentDetail({ item }: { item: DevtoolItem & { type: "component" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Component" value={item.component} mono />
      {Object.keys(item.data).length > 0 && (
        <CollapsibleSection title="Data" defaultOpen>
          <JsonViewer data={item.data} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function ContainerDetail({ item }: { item: DevtoolItem & { type: "container" } }) {
  return (
    <div className="space-y-1">
      <MetadataRow label="Block" value={item.blockName} mono />
      {item.label && <MetadataRow label="Label" value={item.label} />}
    </div>
  );
}

function StateChangeDetail({ item }: { item: DevtoolItem & { type: "state_change" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Scope" value={item.scope} />
      <MetadataRow label="Operation" value={item.operation} mono />
      {item.path && <MetadataRow label="Path" value={item.path} mono />}
      <MetadataRow label="Version" value={String(item.version)} />
      {item.delta !== undefined && (
        <CollapsibleSection title="Delta" defaultOpen>
          <JsonViewer data={item.delta} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function ResourceChangeDetail({ item }: { item: DevtoolItem & { type: "resource_change" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Resource" value={item.resourcePath} mono />
      <MetadataRow label="Change" value={item.changeType} />
      <MetadataRow label="Scope" value={item.scope} />
      {item.delta !== undefined && (
        <CollapsibleSection title="Delta" defaultOpen>
          <JsonViewer data={item.delta} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function StatusDetail({ item }: { item: DevtoolItem & { type: "status" } }) {
  return (
    <div className="space-y-1">
      <MetadataRow label="Message" value={item.message} />
      {item.detail !== undefined && (
        <CollapsibleSection title="Detail" defaultOpen>
          <JsonViewer data={item.detail} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function BlockToolOutputDetail({ item }: { item: DevtoolItem & { type: "tool_output" } }) {
  const isFailed = item.status === "failed";
  return (
    <div className="space-y-2">
      <MetadataRow label="Block" value={item.blockName} mono />
      <MetadataRow label="Tool" value={item.toolCall.name} mono />
      <MetadataRow label="Call ID" value={item.toolCall.callId} mono />
      <MetadataRow label="Generator" value={item.toolCall.generatorBlock} />
      {isFailed && item.error && (
        <div className="rounded bg-red-950/30 border border-red-800/50 px-3 py-2">
          <span className="text-[10px] uppercase text-red-400 font-medium">Error</span>
          <p className="text-xs text-red-300 mt-0.5 font-mono">{item.error.message}</p>
          {item.error.code && (
            <p className="text-[10px] text-red-400/60 mt-0.5 font-mono">{item.error.code}</p>
          )}
        </div>
      )}
      <CollapsibleSection title="Arguments" defaultOpen>
        <JsonViewer data={safeParseJson(item.toolCall.arguments)} />
      </CollapsibleSection>
      {!isFailed && item.output !== undefined && (
        <CollapsibleSection title="Output" defaultOpen>
          <ToolOutputView value={item.output} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function RouterDecisionDetail({ item }: { item: DevtoolItem & { type: "router_decision" } }) {
  return (
    <div className="space-y-1">
      <MetadataRow label="Router" value={item.routerName} mono />
      <MetadataRow label="Selected Route" value={item.selectedRoute} />
    </div>
  );
}

function SourceDetail({ item }: { item: DevtoolItem & { type: "source" } }) {
  return (
    <div className="space-y-1">
      <MetadataRow label="Source ID" value={item.sourceId} mono />
      <MetadataRow label="URL">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline break-all text-right"
        >
          {item.url}
        </a>
      </MetadataRow>
      {item.title && <MetadataRow label="Title" value={item.title} />}
    </div>
  );
}

function StateSnapshotDetail({ item }: { item: DevtoolItem & { type: "state_snapshot" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Block" value={item.provenance.blockName} mono />
      <MetadataRow label="Step" value={item.stepName === "__initial__" ? "initial" : item.stepName} />
      <MetadataRow label="Step Index" value={item.stepIndex === -1 ? "initial" : String(item.stepIndex)} />
      <MetadataRow label="Version" value={String(item.version)} />
      <CollapsibleSection title="State" defaultOpen>
        <JsonViewer data={item.state} />
      </CollapsibleSection>
    </div>
  );
}

// FIX-573: BlockDebugDetail removed; block_trace.generator + input.connected
// surface in BlockNodeDetail instead.

/* --- Shared components --- */

function TypePill({ type }: { type: string }) {
  const colors: Record<string, string> = {
    message: "text-blue-400 border-blue-800/50",
    block_output: "text-green-400 border-green-800/50",
    error: "text-red-400 border-red-800/50",
    reasoning: "text-slate-400 border-slate-700",
    component: "text-cyan-400 border-cyan-800/50",
    container: "text-slate-500 border-slate-700",
    context: "text-slate-500 border-slate-700",
    state_change: "text-amber-500 border-amber-800/50",
    resource_change: "text-blue-500 border-blue-800/50",
    status: "text-slate-500 border-slate-700",
    block_tool_output: "text-purple-400 border-purple-800/50",
    router_decision: "text-orange-400 border-orange-800/50",
    source: "text-blue-400 border-blue-800/50",
    state_snapshot: "text-amber-500 border-amber-800/50",
    block_debug: "text-purple-500 border-purple-800/50",
  };
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0 rounded border ${colors[type] ?? "text-slate-500 border-slate-700"}`}>
      {type}
    </span>
  );
}

function MetadataRow({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-slate-500 shrink-0">{label}</span>
      {children ?? (
        <span className={`text-slate-300 text-right break-all ${mono ? "font-mono text-[11px]" : ""}`}>
          {value}
        </span>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className="flex items-center gap-1 w-full text-left py-0.5"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        {open ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />}
        <span className="text-[10px] font-medium uppercase text-slate-500">{title}</span>
      </button>
      {open && <div className="pl-4 mt-0.5">{children}</div>}
    </div>
  );
}

