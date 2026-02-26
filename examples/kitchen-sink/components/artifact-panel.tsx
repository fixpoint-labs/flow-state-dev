"use client";

import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Package } from "lucide-react";

type ArtifactSummary = { id: string; title: string };
type ArtifactDetail = {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
};

interface ArtifactPanelProps {
  artifacts: ArtifactSummary[];
  artifactsDetail: ArtifactDetail[];
  isSaving: boolean;
  onSaveArtifact: (artifact: { id: string; title: string; content: string }) => Promise<void>;
}

export function ArtifactPanel({
  artifacts,
  artifactsDetail,
  isSaving,
  onSaveArtifact
}: ArtifactPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (selectedId === null && artifacts.length > 0) {
      setSelectedId(artifacts[0].id);
    }
  }, [artifacts, selectedId]);

  const selectedArtifact = useMemo(
    () => artifactsDetail.find((artifact) => artifact.id === selectedId) ?? null,
    [artifactsDetail, selectedId]
  );

  useEffect(() => {
    if (!selectedArtifact) {
      setTitle("");
      setContent("");
      return;
    }

    setTitle(selectedArtifact.title);
    setContent(selectedArtifact.content);
  }, [selectedArtifact?.id, selectedArtifact?.title, selectedArtifact?.content]);

  const hasUnsavedChanges =
    selectedArtifact !== null &&
    (title !== selectedArtifact.title || content !== selectedArtifact.content);

  return (
    <aside className="flex h-full w-[28rem] shrink-0 flex-col border-l bg-muted/30">
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
      <div className="grid min-h-0 flex-1 grid-cols-[14rem_1fr]">
        <ScrollArea className="border-r p-2">
          <div className="flex flex-col gap-1">
            {artifacts.map((artifact) => {
              const isSelected = artifact.id === selectedId;
              return (
                <button
                  type="button"
                  key={artifact.id}
                  onClick={() => setSelectedId(artifact.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
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
              );
            })}
            {artifacts.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No artifacts created yet. Ask the assistant to create or modify project artifacts.
              </p>
            )}
          </div>
        </ScrollArea>
        <div className="min-h-0 p-3">
          {selectedArtifact ? (
            <div className="flex h-full flex-col gap-3">
              <Input
                aria-label="Artifact title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={isSaving}
              />
              <Textarea
                aria-label="Artifact content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="min-h-[18rem] flex-1"
                disabled={isSaving}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Updated {new Date(selectedArtifact.updatedAt).toLocaleTimeString()}
                </span>
                <Button
                  type="button"
                  onClick={() =>
                    void onSaveArtifact({
                      id: selectedArtifact.id,
                      title,
                      content
                    })
                  }
                  disabled={!hasUnsavedChanges || isSaving || title.trim().length === 0}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Select an artifact to edit.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
