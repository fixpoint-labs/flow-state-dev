/**
 * Visual renderer for `BlockValue` outputs (FIX-413). Every surface that
 * shows a block's output — the inline trace tree, the right-pane block
 * detail, and the per-item detail view — routes through this component
 * so the kind discrimination (`inline` / `ref` / `structure` / `omitted`) is rendered
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

/** Narrows an unknown payload to a `BlockValue` (inline / ref / structure). */
export function isInternalBlockValue(v: unknown): v is BlockValueInternal<unknown> {
  if (typeof v !== "object" || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  return kind === "inline" || kind === "ref" || kind === "structure" || kind === "omitted";
}

/**
 * The one renderer for a value the record left out (FIX-1772): a block output
 * or a tool result over the server's record limit. Shows the size and the
 * preview the record kept, marked as omitted, so nobody reads the preview as
 * the whole value.
 */
export function OmittedValueView({
  value,
  className,
}: {
  value: { bytes: number | null; preview: string };
  className?: string;
}) {
  const size = value.bytes === null ? "could not be serialized" : `${value.bytes.toLocaleString()} bytes`;
  return (
    <div className={className}>
      <KindPill kind="omitted" detail={size} />
      <div className="mt-1 text-[11px] text-fs-ink4 italic">
        Over the record limit. The run had the full value; the record keeps this preview.
      </div>
      {value.preview.length > 0 && (
        <pre className="mt-1 whitespace-pre-wrap break-all font-fs-mono text-[11px] text-fs-ink3">{value.preview}…</pre>
      )}
    </div>
  );
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

  if (value.kind === "omitted") {
    return <OmittedValueView value={value} className={className} />;
  }

  // structure
  const entries = value.shape.container === "array"
    ? value.shape.entries.map((entry, i) => ({ key: String(i), entry }))
    : Object.entries(value.shape.entries).map(([key, entry]) => ({ key, entry }));

  return (
    <div className={className}>
      <KindPill kind="structure" detail={value.shape.container} />
      <div className="mt-1 space-y-1.5 border-l border-fs-ink/20 pl-2">
        {entries.map(({ key, entry }) => (
          <div key={key} className="space-y-0.5">
            <span className="font-fs-mono text-[10px] text-fs-ink4">{key}</span>
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
      <div className="mt-1 text-[11px] text-fs-ink4 italic">(source not retained)</div>
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
        "inline-flex items-center gap-1.5 font-fs-mono text-[11px] border px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fs-blue/40 " +
        (canSelect
          ? "border-fs-blue/60 text-fs-blue hover:border-fs-blue hover:bg-fs-blue/10 cursor-pointer"
          : "border-fs-ink/20 text-fs-ink4 cursor-not-allowed")
      }
    >
      <Link2 className="h-3 w-3 shrink-0" />
      <span className="text-fs-ink4">ref →</span>
      <span className="truncate max-w-[16rem]">{label}</span>
    </button>
  );
}

function KindPill({
  kind,
  detail,
}: {
  kind: "inline" | "ref" | "structure" | "omitted";
  detail?: string;
}) {
  const styles: Record<"inline" | "ref" | "structure" | "omitted", string> = {
    inline: "border-fs-ink/30 text-fs-ink3",
    ref: "border-fs-blue/60 text-fs-blue",
    structure: "border-fs-ink/45 text-fs-ink2",
    // Omitted is a note about the record, not a failure of the run.
    omitted: "border-dashed border-fs-ink3 text-fs-ink3",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 font-fs-mono text-[9.5px] uppercase tracking-[.08em] border px-1 py-0 ${styles[kind]}`}
    >
      {kind === "structure" && <Package className="h-3 w-3 shrink-0" />}
      <span>{detail ? `${kind} (${detail})` : kind}</span>
    </span>
  );
}
