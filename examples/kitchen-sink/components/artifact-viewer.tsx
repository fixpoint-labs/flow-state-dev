"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { FileText, Pencil, X, ChevronLeft } from "lucide-react";
import { Streamdown } from "streamdown";

const streamdownPlugins = { cjk, code, math, mermaid };

type ArtifactDetail = { id: string; title: string; content: string; updatedAt: number };

interface ArtifactViewerProps {
  artifact: ArtifactDetail;
  isSaving: boolean;
  onSaveArtifact: (artifact: { id: string; title: string; content: string }) => Promise<void>;
  onClose: () => void;
  onBack: () => void;
  className?: string;
}

export function ArtifactViewer({ artifact, isSaving, onSaveArtifact, onClose, onBack, className }: ArtifactViewerProps) {
  const [title, setTitle] = useState(artifact.title);
  const [content, setContent] = useState(artifact.content);
  const [isEditing, setIsEditing] = useState(false);

  // Reset local state and return to view mode when the selected artifact changes
  useEffect(() => {
    setTitle(artifact.title);
    setContent(artifact.content);
    setIsEditing(false);
  }, [artifact.id, artifact.title, artifact.content]);

  const hasUnsavedChanges = title !== artifact.title || content !== artifact.content;

  const handleCancel = () => {
    setTitle(artifact.title);
    setContent(artifact.content);
    setIsEditing(false);
  };

  const handleSave = async () => {
    await onSaveArtifact({ id: artifact.id, title, content });
    setIsEditing(false);
  };

  return (
    <aside className={cn("flex h-full w-full min-w-0 shrink-0 flex-col border-l bg-background sm:w-[480px]", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to artifact list">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-semibold">
          {isEditing ? title : artifact.title}
        </span>
        {!isEditing && (
          <Button variant="ghost" size="icon-sm" onClick={() => setIsEditing(true)} aria-label="Edit artifact">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close artifact viewer">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Separator />

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
        {isEditing ? (
          <>
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
              className="min-h-0 flex-1 resize-none"
              disabled={isSaving}
            />
          </>
        ) : (
          <ScrollArea className="flex-1">
            <Streamdown
              className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              plugins={streamdownPlugins}
            >
              {artifact.content}
            </Streamdown>
          </ScrollArea>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Updated {new Date(artifact.updatedAt).toLocaleTimeString()}
          </span>
          {isEditing && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleSave()}
                disabled={!hasUnsavedChanges || isSaving || title.trim().length === 0}
              >
                Save
              </Button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
