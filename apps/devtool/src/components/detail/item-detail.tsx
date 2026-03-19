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
import type { OutputItem } from "@flow-state-dev/core/items";
import { Button } from "@/components/ui/button";
import { useSelection } from "@/context/selection-context";
import { StatusBadge } from "@/components/shared/status-badge";
import { JsonViewer } from "@/components/shared/json-viewer";
import { EmptyState } from "@/components/shared/empty-state";
import { safeParseJson } from "@/lib/utils";

export function ItemDetail() {
  const { selectedItem } = useSelection();

  if (!selectedItem) {
    return (
      <EmptyState message="Select an item to inspect its details." className="h-full" />
    );
  }

  return <ItemDetailContent item={selectedItem} />;
}

function ItemDetailContent({ item }: { item: OutputItem }) {
  const handleCopy = () => {
    void navigator.clipboard.writeText(JSON.stringify(item, null, 2));
  };

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

function ItemTypeDetail({ item }: { item: OutputItem }) {
  switch (item.type) {
    case "message":
      return <MessageDetail item={item} />;
    case "block_output":
      return <BlockOutputDetail item={item} />;
    case "error":
      return <ErrorDetail item={item} />;
    case "step_error":
      return <StepErrorDetail item={item} />;
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
    case "context":
      return <ContextDetail item={item} />;
    case "status":
      return <StatusDetail item={item} />;
    case "block_tool_output":
      return <BlockToolOutputDetail item={item} />;
    case "router_decision":
      return <RouterDecisionDetail item={item} />;
    case "source":
      return <SourceDetail item={item} />;
    default:
      return <JsonViewer data={item} />;
  }
}

/* --- Per-type detail sections --- */

function MessageDetail({ item }: { item: OutputItem & { type: "message" } }) {
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

function BlockOutputDetail({ item }: { item: OutputItem & { type: "block_output" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Block" value={item.blockName} mono />
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
          <JsonViewer data={item.output} />
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

function ErrorDetail({ item }: { item: OutputItem & { type: "error" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Message" value={item.message} />
      {item.code && <MetadataRow label="Code" value={item.code} mono />}
    </div>
  );
}

function StepErrorDetail({ item }: { item: OutputItem & { type: "step_error" } }) {
  return (
    <div className="space-y-2">
      <MetadataRow label="Message" value={item.message} />
      {item.code && <MetadataRow label="Code" value={item.code} mono />}
      {item.blockName && <MetadataRow label="Block" value={item.blockName} />}
      <MetadataRow label="Recovered" value={item.recovered ? "Yes" : "No"} />
    </div>
  );
}

function ReasoningDetail({ item }: { item: OutputItem & { type: "reasoning" } }) {
  const text = item.summary.map((c) => ("text" in c ? (c as { text: string }).text : "")).join("");
  return (
    <div>
      <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  );
}

function ComponentDetail({ item }: { item: OutputItem & { type: "component" } }) {
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

function ContainerDetail({ item }: { item: OutputItem & { type: "container" } }) {
  return (
    <div className="space-y-1">
      <MetadataRow label="Block" value={item.blockName} mono />
      {item.label && <MetadataRow label="Label" value={item.label} />}
    </div>
  );
}

function StateChangeDetail({ item }: { item: OutputItem & { type: "state_change" } }) {
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

function ResourceChangeDetail({ item }: { item: OutputItem & { type: "resource_change" } }) {
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

function ContextDetail({ item }: { item: OutputItem & { type: "context" } }) {
  return (
    <div>
      <p className="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed">{item.text}</p>
    </div>
  );
}

function StatusDetail({ item }: { item: OutputItem & { type: "status" } }) {
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

function BlockToolOutputDetail({ item }: { item: OutputItem & { type: "block_tool_output" } }) {
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
          <JsonViewer data={item.output} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function RouterDecisionDetail({ item }: { item: OutputItem & { type: "router_decision" } }) {
  return (
    <div className="space-y-1">
      <MetadataRow label="Router" value={item.routerName} mono />
      <MetadataRow label="Selected Route" value={item.selectedRoute} />
    </div>
  );
}

function SourceDetail({ item }: { item: OutputItem & { type: "source" } }) {
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

/* --- Shared components --- */

function TypePill({ type }: { type: string }) {
  const colors: Record<string, string> = {
    message: "text-blue-400 border-blue-800/50",
    block_output: "text-green-400 border-green-800/50",
    error: "text-red-400 border-red-800/50",
    step_error: "text-amber-400 border-amber-800/50",
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

