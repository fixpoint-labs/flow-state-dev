"use client";

import { memo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { MessageResponse } from "@/src/components/ai-elements/message";
import { FileText, X, ChevronLeft } from "lucide-react";

type ArtifactSummary = { id: string; title: string; content: string };

interface ArtifactViewerProps {
  artifact: ArtifactSummary;
  onClose: () => void;
  onBack: () => void;
}

const ArtifactContent = memo(
  ({ content }: { content: string }) => (
    <MessageResponse>{content}</MessageResponse>
  ),
  (prev, next) => prev.content === next.content
);

ArtifactContent.displayName = "ArtifactContent";

export function ArtifactViewer({ artifact, onClose, onBack }: ArtifactViewerProps) {
  return (
    <aside className="flex h-full w-[480px] shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back to artifact list"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold truncate flex-1">
          {artifact.title}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close artifact viewer"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Separator />

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 text-sm">
          {artifact.content ? (
            <ArtifactContent content={artifact.content} />
          ) : (
            <p className="text-muted-foreground italic">No content yet.</p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
