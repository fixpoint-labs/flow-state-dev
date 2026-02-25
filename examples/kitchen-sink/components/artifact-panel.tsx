"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { FileText, Package } from "lucide-react";

type ArtifactSummary = { id: string; title: string };

interface ArtifactPanelProps {
  artifacts: ArtifactSummary[];
}

export function ArtifactPanel({ artifacts }: ArtifactPanelProps) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-l bg-muted/30">
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
      <ScrollArea className="flex-1 p-2">
        <div className="flex flex-col gap-1">
          {artifacts.map((artifact) => (
            <div
              key={artifact.id}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <FileText className="h-4 w-4 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="truncate font-medium text-foreground">
                  {artifact.title}
                </span>
                <span className="truncate text-xs">{artifact.id}</span>
              </div>
            </div>
          ))}
          {artifacts.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No artifacts created yet. Ask the assistant to create or modify
              project artifacts.
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
