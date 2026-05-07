/**
 * Visual renderer for `BlockValue` outputs (FIX-413). Every surface that
 * shows a block's output — the inline trace tree, the right-pane block
 * detail, and the per-item detail view — routes through this component
 * so the kind discrimination (`inline` / `ref` / `structure`) is rendered
 * the same way everywhere.
 *
 * Refs resolve their `sourceItemId` against the trace context to display
 * the source block's *name*, not its raw item id, and dispatch the
 * existing `selectBlock` action when clicked so the user can jump-select
 * the producing block in the trace tree (FIX-556).
 */
import type { ItemLookup } from "@flow-state-dev/core/items";
import type { BlockValueInternal } from "@flow-state-dev/core/items/internal";
import { resolveBlockValueInternal } from "@flow-state-dev/core/items/internal";
import { Link2, Package } from "lucide-react";
import { JsonViewer } from "./json-viewer";
import { useTraceLookup } from "../../context/trace-context";
import { useSelection } from "../../context/selection-context";
import { resolveSourceBlock } from "../../lib/source-block";
import type { DevtoolItem } from "../../lib/item-types";

type BlockValueViewProps = {
  value: BlockValueInternal<unknown> | undefined;
  /** Optional className applied to the outer wrapper. */
  className?: string;
};

function isInternalBlockValue(v: unknown): v is BlockValueInternal<unknown> {
  if (typeof v !== "object" || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  return kind === "inline" || kind === "ref" || kind === "structure";
}

export function BlockValueView({ value, className }: BlockValueViewProps) {
  if (value === undefined) return null;

  if (!isInternalBlockValue(value)) {
    // Legacy / handler-raw values (pre-FIX-413). Render directly so older
    // shapes still inspect cleanly.
    return <JsonViewer data={value} className={className} />;
  }

  if (value.kind === "inline") {
    return (
      <div className={className}>
        <KindPill kind="inline" />
        <JsonViewer data={value.value} className="mt-1" />
      </div>
    );
  }

  if (value.kind === "ref") {
    return (
      <div className={className}>
        <RefBadge sourceItemId={value.sourceItemId} />
        <RefResolvedValue sourceItemId={value.sourceItemId} />
      </div>
    );
  }

  // structure
  const entries = value.shape.container === "array"
    ? value.shape.entries.map((entry, i) => ({ key: String(i), entry }))
    : Object.entries(value.shape.entries).map(([key, entry]) => ({ key, entry }));

  return (
    <div className={className}>
      <KindPill kind="structure" detail={value.shape.container} />
      <div className="mt-1 space-y-1.5 border-l border-amber-900/40 pl-2">
        {entries.map(({ key, entry }) => (
          <div key={key} className="space-y-0.5">
            <span className="text-[10px] font-mono text-slate-500">{key}</span>
            <BlockValueView value={entry} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Convenience wrapper for surfaces that hold a non-`BlockValue` payload
 * (currently `block_tool_output.output: unknown`). Renders the same
 * inline pill + JSON treatment so the visual language matches without
 * forcing every caller to fabricate a fake `inline` BlockValue.
 */
export function ToolOutputView({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  if (value === undefined) return null;
  return (
    <div className={className}>
      <KindPill kind="inline" />
      <JsonViewer data={value} className="mt-1" />
    </div>
  );
}

/**
 * Resolves a ref's `sourceItemId` to its underlying content and renders it
 * inline beneath the ref pill, so a ref reads as "this block re-emits the
 * output of {sourceBlock}, which was: {value}". `resolveBlockValue` deep-
 * resolves through the source's own BlockValue (or joins the text content
 * for FIX-480 message refs), giving us the same payload the runtime sees.
 */
function RefResolvedValue({ sourceItemId }: { sourceItemId: string }) {
  const { getItem } = useTraceLookup();
  const sourceItem = getItem(sourceItemId);
  if (!sourceItem) {
    return (
      <div className="mt-1 text-[11px] text-slate-500 italic">(source not retained)</div>
    );
  }

  let resolved: unknown;
  if (sourceItem.type === "block_trace") {
    resolved = resolveBlockValueInternal(sourceItem.output, getItem as ItemLookup);
  } else if (sourceItem.type === "message") {
    resolved = sourceItem.content
      .map((part) => ("text" in part ? (part as { text: string }).text : ""))
      .join("");
  } else {
    resolved = sourceItem;
  }

  return <JsonViewer data={resolved} className="mt-1" />;
}

function RefBadge({ sourceItemId }: { sourceItemId: string }) {
  const { getItem, getBlockNode } = useTraceLookup();
  const { selectBlock } = useSelection();

  const resolved = resolveSourceBlock(sourceItemId, getItem);
  const node = resolved ? getBlockNode(resolved.blockInstanceId) : null;

  const label = resolved ? resolved.blockName : "(not retained)";
  const canSelect = !!node;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node) selectBlock(node);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canSelect}
      title={sourceItemId}
      className={
        "inline-flex items-center gap-1.5 text-[11px] font-mono rounded border px-1.5 py-0.5 " +
        (canSelect
          ? "border-sky-700/60 text-sky-300 hover:bg-sky-950/40 cursor-pointer"
          : "border-slate-700 text-slate-500 cursor-not-allowed")
      }
    >
      <Link2 className="h-3 w-3 shrink-0" />
      <span className="text-slate-500">ref →</span>
      <span className="truncate max-w-[16rem]">{label}</span>
    </button>
  );
}

function KindPill({
  kind,
  detail,
}: {
  kind: "inline" | "ref" | "structure";
  detail?: string;
}) {
  const styles: Record<"inline" | "ref" | "structure", string> = {
    inline: "border-slate-700 text-slate-400",
    ref: "border-sky-700/60 text-sky-300",
    structure: "border-amber-700/60 text-amber-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase font-mono rounded border px-1.5 py-0 ${styles[kind]}`}
    >
      {kind === "structure" && <Package className="h-3 w-3 shrink-0" />}
      <span>{detail ? `${kind} (${detail})` : kind}</span>
    </span>
  );
}
