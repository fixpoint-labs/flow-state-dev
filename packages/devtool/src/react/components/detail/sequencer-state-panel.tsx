/**
 * Sequencer state inspector panel.
 *
 * Shows the current state of a sequencer block. Under the keyed-update model
 * (FIX-401), the trace tree retains a single snapshot per sequencer instance,
 * so the panel renders that snapshot directly. The timeline / diff /
 * step-name UI only appears when a feed produces multiple snapshots
 * (a future opt-in `persistFullHistory` mode would reintroduce that).
 */
import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import type { StateSnapshot } from "../../lib/trace-tree";
import { JsonViewer } from "../shared/json-viewer";
import { cn } from "../../lib/utils";

type SequencerStatePanelProps = {
  snapshots: StateSnapshot[];
};

export function SequencerStatePanel({ snapshots }: SequencerStatePanelProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(snapshots.length - 1);
  const [diffMode, setDiffMode] = useState(false);

  const selected = snapshots[selectedIndex];
  const hasTimeline = snapshots.length > 1;

  // Compute diff between adjacent snapshots for the diff view.
  const diff = useMemo(() => {
    if (!diffMode || selectedIndex <= 0) return null;
    const prev = snapshots[selectedIndex - 1];
    if (!prev || !selected) return null;
    return computeShallowDiff(prev.state, selected.state);
  }, [diffMode, selectedIndex, snapshots, selected]);

  if (snapshots.length === 0) {
    return (
      <div className="py-2 text-[11px] italic text-fs-ink4">
        No state configured for this sequencer.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Step timeline — only shown when there are multiple snapshots to navigate */}
      {hasTimeline && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {snapshots.map((snap, i) => {
            const isInitial = snap.stepIndex === -1;
            const label = isInitial ? "init" : snap.stepName;
            const isSelected = i === selectedIndex;

            return (
              <button
                key={`${snap.stepIndex}-${snap.ts}`}
                className={cn(
                  "border px-1.5 py-0.5 font-fs-mono text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fs-blue/40",
                  isSelected
                    ? "border-fs-blue bg-fs-blue/10 text-fs-blue"
                    : "border-fs-ink/30 text-fs-ink3 hover:border-fs-ink hover:text-fs-ink",
                )}
                onClick={() => setSelectedIndex(i)}
                title={isInitial ? "Initial state" : `State changed after: ${snap.stepName} (step ${snap.stepIndex})`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Controls — diff toggle requires at least two frames; step indicator only adds noise when there's just one */}
      {hasTimeline && (
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1 font-fs-mono text-[10px] text-fs-ink3">
            <input
              type="checkbox"
              checked={diffMode}
              onChange={(e) => setDiffMode(e.target.checked)}
              className="h-3 w-3 border-fs-ink/45 bg-fs-card accent-[var(--fs-blue)]"
            />
            Show diff
          </label>
          {selected && (
            <span className="ml-auto font-fs-mono text-[10px] text-fs-ink4">
              step {selected.stepIndex === -1 ? "init" : selected.stepIndex}
            </span>
          )}
        </div>
      )}

      {/* State display */}
      {selected && (
        <div>
          {diffMode && diff ? (
            <DiffView diff={diff} />
          ) : (
            <JsonViewer data={selected.state} />
          )}
        </div>
      )}
    </div>
  );
}

type DiffEntry = {
  key: string;
  type: "added" | "removed" | "changed" | "unchanged";
  prev?: unknown;
  next?: unknown;
};

function computeShallowDiff(prev: unknown, next: unknown): DiffEntry[] {
  const prevObj = (typeof prev === "object" && prev !== null) ? prev as Record<string, unknown> : {};
  const nextObj = (typeof next === "object" && next !== null) ? next as Record<string, unknown> : {};
  const allKeys = new Set([...Object.keys(prevObj), ...Object.keys(nextObj)]);
  const entries: DiffEntry[] = [];

  for (const key of allKeys) {
    const hasPrev = key in prevObj;
    const hasNext = key in nextObj;

    if (!hasPrev && hasNext) {
      entries.push({ key, type: "added", next: nextObj[key] });
    } else if (hasPrev && !hasNext) {
      entries.push({ key, type: "removed", prev: prevObj[key] });
    } else if (JSON.stringify(prevObj[key]) !== JSON.stringify(nextObj[key])) {
      entries.push({ key, type: "changed", prev: prevObj[key], next: nextObj[key] });
    } else {
      entries.push({ key, type: "unchanged", next: nextObj[key] });
    }
  }

  // Sort: changed/added/removed first, unchanged last.
  return entries.sort((a, b) => {
    const order = { changed: 0, added: 1, removed: 2, unchanged: 3 };
    return order[a.type] - order[b.type];
  });
}

function DiffView({ diff }: { diff: DiffEntry[] }) {
  return (
    <div className="space-y-1 border border-fs-ink/20 bg-fs-card p-3 font-fs-mono text-[11.5px] leading-[1.55] text-fs-ink2">
      {diff.map((entry) => (
        <div key={entry.key} className="flex items-start gap-2">
          <DiffIndicator type={entry.type} />
          <span className="text-fs-ink">{entry.key}:</span>
          {entry.type === "changed" ? (
            <span>
              <span className="text-fs-red line-through">{formatValue(entry.prev)}</span>
              {" "}
              <span className="text-fs-green">{formatValue(entry.next)}</span>
            </span>
          ) : entry.type === "removed" ? (
            <span className="text-fs-red line-through">{formatValue(entry.prev)}</span>
          ) : (
            <span className={entry.type === "added" ? "text-fs-green" : "text-fs-ink3"}>
              {formatValue(entry.next)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function DiffIndicator({ type }: { type: DiffEntry["type"] }) {
  const styles = {
    added: "text-fs-green",
    removed: "text-fs-red",
    changed: "text-fs-blue",
    unchanged: "text-fs-ink5",
  };
  const symbols = { added: "+", removed: "-", changed: "~", unchanged: " " };

  return (
    <span className={cn("w-3 text-center shrink-0", styles[type])}>
      {symbols[type]}
    </span>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  return JSON.stringify(value);
}

/**
 * Collapsible wrapper used in the detail panel to house the sequencer state section.
 */
export function SequencerStateSection({ snapshots }: { snapshots: StateSnapshot[] }) {
  const [open, setOpen] = useState(true);
  // Only annotate the section header with a snapshot count when multiple
  // frames are available — keyed-update single-snapshot is the common case
  // and `(1 snapshot)` is just visual clutter.
  const hasMultipleSnapshots = snapshots.length > 1;

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 py-0.5 text-left text-fs-ink3 hover:text-fs-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fs-blue/40"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Layers className="h-3 w-3" />
        <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em]">
          Sequencer State
        </span>
        {hasMultipleSnapshots && (
          <span className="ml-1 font-fs-mono text-[10px] text-fs-ink4">
            ({snapshots.length} snapshots)
          </span>
        )}
      </button>
      {open && (
        <div className="pl-4 mt-1">
          <SequencerStatePanel snapshots={snapshots} />
        </div>
      )}
    </div>
  );
}
