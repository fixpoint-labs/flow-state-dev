import { cn } from "../../lib/utils";

// Block kinds are told apart by their mono label, not by hue.
const kindLabels: Record<string, string> = {
  generator: "GEN",
  evaluator: "EVL",
  handler: "HDL",
  sequencer: "SEQ",
  router: "RTR",
};

export function KindIndicator({ kind, className }: { kind: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.08em] text-fs-ink">
        {kindLabels[kind] ?? kind}
      </span>
    </span>
  );
}
