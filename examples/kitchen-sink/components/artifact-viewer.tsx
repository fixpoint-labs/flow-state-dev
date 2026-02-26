"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { FileText, X, ChevronLeft } from "lucide-react";

type ArtifactDetail = { id: string; title: string; content: string; updatedAt: number };

interface ArtifactViewerProps {
  artifact: ArtifactDetail;
  isSaving: boolean;
  onSaveArtifact: (artifact: { id: string; title: string; content: string }) => Promise<void>;
  onClose: () => void;
  onBack: () => void;
}

export function ArtifactViewer({ artifact, isSaving, onSaveArtifact, onClose, onBack }: ArtifactViewerProps) {
  const [title, setTitle] = useState(artifact.title);
  const [content, setContent] = useState(artifact.content);

  useEffect(() => {
    setTitle(artifact.title);
    setContent(artifact.content);
  }, [artifact.id, artifact.title, artifact.content]);

  const hasUnsavedChanges = title !== artifact.title || content !== artifact.content;

  return (
    <aside className="flex h-full w-[480px] shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to artifact list">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-semibold">{title}</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close artifact viewer">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Separator />

      {/* Edit form */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Input
          aria-label="Artifact title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isSaving}
        />
        <Textarea
          aria-label="Artifact content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="flex-1 resize-none"
          disabled={isSaving}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Updated {new Date(artifact.updatedAt).toLocaleTimeString()}
          </span>
          <Button
            type="button"
            onClick={() => void onSaveArtifact({ id: artifact.id, title, content })}
            disabled={!hasUnsavedChanges || isSaving || title.trim().length === 0}
          >
            Save
          </Button>
        </div>
      </div>
    </aside>
  );
}
