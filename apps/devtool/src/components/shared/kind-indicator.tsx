import { cn } from "@/lib/utils";

const kindColors: Record<string, string> = {
  generator: "bg-green-500",
  handler: "bg-green-500",
  sequencer: "bg-blue-500",
  router: "bg-purple-500",
};

const kindLabels: Record<string, string> = {
  generator: "GEN",
  handler: "HDL",
  sequencer: "SEQ",
  router: "RTR",
};

export function KindIndicator({ kind, className }: { kind: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className={cn("inline-block h-2 w-2 rounded-full", kindColors[kind] ?? "bg-slate-500")} />
      <span className="text-[10px] font-medium uppercase text-slate-500">
        {kindLabels[kind] ?? kind}
      </span>
    </span>
  );
}
