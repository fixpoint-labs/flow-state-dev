import { Copy } from "lucide-react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSelection } from "@/context/selection-context";
import { StatusBadge } from "@/components/shared/status-badge";
import { JsonViewer } from "@/components/shared/json-viewer";
import { EmptyState } from "@/components/shared/empty-state";

export function ItemDetail() {
  const { selectedItem } = useSelection();

  if (!selectedItem) {
    return (
      <EmptyState message="Select an item in the Stream or Trace view to inspect its details." className="h-full" />
    );
  }

  return <ItemDetailContent item={selectedItem} />;
}

function ItemDetailContent({ item }: { item: OutputItem }) {
  const handleCopy = () => {
    void navigator.clipboard.writeText(JSON.stringify(getCanonicalOutput(item), null, 2));
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase text-slate-500">Item Detail</span>
        <Badge variant="outline" className="text-[10px] px-1 py-0 border-slate-700 text-slate-400">
          {item.type}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <MetadataRow label="Block Name" value={item.provenance.blockName} />
        <MetadataRow label="Status">
          <StatusBadge status={item.status} />
        </MetadataRow>
        <MetadataRow label="Item Index" value={String(item.itemIndex)} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-medium uppercase text-slate-500">Canonical Output</span>
          <Button variant="ghost" size="sm" className="h-5 px-1.5" onClick={handleCopy} title="Copy JSON">
            <Copy className="h-3 w-3" />
          </Button>
        </div>
        <JsonViewer data={getCanonicalOutput(item)} />
      </div>

      <div>
        <span className="text-[10px] font-medium uppercase text-slate-500">Provenance</span>
        <div className="mt-1 space-y-1">
          <MetadataRow label="Instance ID" value={item.provenance.blockInstanceId} mono />
          {item.provenance.parentBlockInstanceId && (
            <MetadataRow label="Parent" value={item.provenance.parentBlockInstanceId} mono />
          )}
          <MetadataRow label="Phase" value={item.provenance.phase} />
          {item.provenance.stepIndex !== undefined && (
            <MetadataRow label="Step Index" value={String(item.provenance.stepIndex)} />
          )}
          {item.provenance.attempt !== undefined && (
            <MetadataRow label="Attempt" value={String(item.provenance.attempt)} />
          )}
        </div>
      </div>

      <div>
        <span className="text-[10px] font-medium uppercase text-slate-500">Transforms</span>
        <div className="mt-1">
          <span className="text-[10px] text-slate-600">No transform applied (passthrough)</span>
        </div>
      </div>
    </div>
  );
}

function MetadataRow({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      {children ?? <span className={`text-slate-300 ${mono ? "font-mono" : ""}`}>{value}</span>}
    </div>
  );
}

function getCanonicalOutput(item: OutputItem): unknown {
  switch (item.type) {
    case "message":
      return item.content.filter((c) => "text" in c).map((c) => ("text" in c ? c.text : "")).join("");
    case "block_output":
      return item.output;
    case "error":
      return { message: item.message, code: item.code };
    case "step_error":
      return { message: item.message, code: item.code, recovered: item.recovered };
    case "reasoning":
      return item.summary;
    case "component":
      return { component: item.component, data: item.data };
    case "status":
      return { message: item.message };
    case "context":
      return { text: item.text };
    case "state_change":
      return { scope: item.scope, operation: item.operation, path: item.path, delta: item.delta };
    case "resource_change":
      return { scope: item.scope, resourcePath: item.resourcePath, changeType: item.changeType };
    case "container":
      return { blockName: item.blockName, label: item.label };
    default:
      return item;
  }
}
