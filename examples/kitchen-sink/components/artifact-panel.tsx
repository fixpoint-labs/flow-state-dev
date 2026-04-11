"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { File, FileCode2, FileText, Package } from "lucide-react";

import {
  FileTree,
  FileTreeFile,
  FileTreeIcon,
  FileTreeName,
} from "@/components/flow-state/file-tree";

type ArtifactSummary = { id: string; title: string; extension?: string | null };

interface ArtifactPanelProps {
  artifacts: ArtifactSummary[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Extension-based icon selection
// ---------------------------------------------------------------------------

const MD_EXTS = new Set(["md", "mdx"]);
const CODE_EXTS = new Set([
  "jsx", "tsx", "ts", "js", "py", "sh", "json", "css", "html",
  "yaml", "yml", "go", "rs", "java", "c", "cpp", "rb", "php",
  "swift", "kt", "sql", "xml", "toml", "scss",
]);

function getFileIcon(extension: string | null | undefined) {
  if (!extension) return FileText;
  const ext = extension.toLowerCase();
  if (MD_EXTS.has(ext)) return FileText;
  if (CODE_EXTS.has(ext)) return FileCode2;
  return File;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
        {artifacts.length > 0 ? (
          <FileTree
            selectedPath={selectedId ?? null}
            onSelect={(path) => onSelect?.(path)}
          >
            {artifacts.map((artifact) => {
              const Icon = getFileIcon(artifact.extension);
              return (
                <FileTreeFile
                  key={artifact.id}
                  path={artifact.id}
                  name={artifact.title}
                  icon={<Icon className="h-4 w-4 text-muted-foreground" />}
                />
              );
            })}
          </FileTree>
        ) : (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            No artifacts created yet. Ask the assistant to create or modify project artifacts.
          </p>
        )}
      </ScrollArea>
    </aside>
  );
}
