"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FileText, Package } from "lucide-react";

type ArtifactSummary = { id: string; title: string };

interface ArtifactPanelProps {
  artifacts: ArtifactSummary[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ArtifactPanel({ artifacts, selectedId, onSelect, className, style }: ArtifactPanelProps) {
  return (
    <aside className={cn("flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-l bg-muted/30", className)} style={style}>
      <div className="flex items-center gap-2 px-4 py-3">
        <Package className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Artifacts</span>
        {artifacts.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {artifacts.length}
          </Badge>
        )}
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1 p-2">
        <div className="flex flex-col gap-1">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => onSelect?.(artifact.id)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                selectedId === artifact.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <FileText className="h-4 w-4 shrink-0" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-foreground">{artifact.title}</span>
                <span className="truncate text-xs">{artifact.id}</span>
              </div>
            </button>
          ))}
          {artifacts.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No artifacts created yet. Ask the assistant to create or modify project artifacts.
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
