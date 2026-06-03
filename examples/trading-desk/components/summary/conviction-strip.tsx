/**
 * ConvictionStrip — convergence/divergence visual. One dot per pipeline
 * participant (9 analysts + research manager + trader + PM), positioned on a
 * bearish ↔ bullish axis by its stored stance (mapped in the aggregate). A
 * tight cluster reads as convergence; a spread reads as divergence.
 *
 * A participant with no published stance renders a hollow dot at center — it is
 * visibly "no signal", not a fabricated neutral. The PM dot is outlined to mark
 * "the decision". All nodes are equal size (honest raw spread; spec 06 §11.3).
 * Dot color is the per-agent hue from the AGENTS table.
 */
import type { CSSProperties, ReactElement } from "react";
import type { ConvictionNode } from "./aggregate";
import { cn } from "@/lib/utils";

export type ConvictionStripProps = {
  nodes: ReadonlyArray<ConvictionNode>;
};

export function ConvictionStrip({ nodes }: ConvictionStripProps): ReactElement {
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Conviction — convergence vs divergence"
    >
      <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        <span>bearish</span>
        <span>conviction</span>
        <span>bullish</span>
      </div>
      <div className="relative h-7">
        {/* Axis line + center tick */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color:var(--c-border)]" />
        <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-[color:var(--c-border)]" />
        {nodes.map((node) => (
          <ConvictionDot key={node.agent} node={node} />
        ))}
      </div>
    </section>
  );
}

function ConvictionDot({ node }: { node: ConvictionNode }): ReactElement {
  // axis ∈ [-1, +1] → left ∈ [0%, 100%]. Hollow node (null axis) sits at center.
  const axis = node.axis ?? 0;
  const leftPct = ((axis + 1) / 2) * 100;
  const filled = node.axis !== null;
  const color = `oklch(62% 0.12 ${node.hue})`;
  const style = {
    left: `${leftPct}%`,
    "--c": color,
  } as CSSProperties & { "--c": string };
  const title =
    node.raw !== null
      ? `${node.role}: ${node.raw}`
      : `${node.role}: no stance`;

  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      style={style}
      className={cn(
        "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
        filled
          ? "bg-[color:var(--c)]"
          : "border border-[color:var(--c-fg-faint)] bg-[color:var(--c-bg)]",
        node.isDecision && "ring-2 ring-[color:var(--c-fg)] ring-offset-1",
      )}
    />
  );
}
