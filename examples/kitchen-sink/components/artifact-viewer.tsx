"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { CheckIcon, ChevronLeft, CopyIcon, Pencil } from "lucide-react";
import type { BundledLanguage } from "shiki";
import { Streamdown } from "streamdown";

import {
  ArtifactShell,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactDescription,
  ArtifactActions,
  ArtifactAction,
  ArtifactContent,
  ArtifactClose,
} from "@/components/flow-state/artifact";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockContainer,
} from "@/components/flow-state/code-block";
const streamdownPlugins = { cjk, code, math, mermaid };

// ---------------------------------------------------------------------------
// Extension-to-renderer mapping
// ---------------------------------------------------------------------------

type RendererType = "markdown" | "code" | "image" | "text";

const MARKDOWN_EXTS = new Set(["md", "mdx"]);
const CODE_EXTS = new Set([
  "jsx", "tsx", "ts", "js", "py", "sh", "bash", "json", "yaml", "yml",
  "css", "scss", "html", "xml", "sql", "go", "rs", "java", "c", "cpp",
  "h", "rb", "php", "swift", "kt", "toml", "ini", "env", "dockerfile",
  "svg",
]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp"]);

/** Infer extension from a filename/title when the stored extension is missing. */
function inferExtension(title: string, storedExtension: string | null | undefined): string | null {
  if (storedExtension) return storedExtension;
  const dot = title.lastIndexOf(".");
  if (dot === -1 || dot === title.length - 1) return null;
  return title.slice(dot + 1).toLowerCase();
}

function getRendererType(extension: string | null): RendererType {
  if (!extension) return "text";
  const ext = extension.toLowerCase();
  if (MARKDOWN_EXTS.has(ext)) return "markdown";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (CODE_EXTS.has(ext)) return "code";
  return "text";
}

/** Map extension to a shiki BundledLanguage identifier. */
function extensionToLanguage(extension: string | null): BundledLanguage {
  if (!extension) return "text" as BundledLanguage;
  const map: Record<string, string> = {
    ts: "typescript", js: "javascript", py: "python", sh: "bash",
    yml: "yaml", scss: "scss", rs: "rust", kt: "kotlin",
    rb: "ruby", cpp: "cpp", dockerfile: "dockerfile",
  };
  return (map[extension.toLowerCase()] ?? extension.toLowerCase()) as BundledLanguage;
}

/** Human-friendly content type label. */
function getContentTypeLabel(extension: string | null): string {
  if (!extension) return "Plain text";
  const labels: Record<string, string> = {
    md: "Markdown", mdx: "MDX", ts: "TypeScript", js: "JavaScript",
    tsx: "TSX", jsx: "JSX", py: "Python", json: "JSON", css: "CSS",
    html: "HTML", yaml: "YAML", yml: "YAML", sh: "Shell",
    png: "PNG Image", jpg: "JPEG Image", jpeg: "JPEG Image",
    gif: "GIF Image", webp: "WebP Image", svg: "SVG",
    ico: "Icon", bmp: "Bitmap Image",
  };
  return labels[extension.toLowerCase()] ?? extension.toUpperCase();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ArtifactDetail = {
  id: string;
  title: string;
  content: string;
  extension: string | null;
  updatedAt: number;
};

interface ArtifactViewerProps {
  artifact: ArtifactDetail;
  isSaving: boolean;
  onSaveArtifact: (artifact: { id: string; title: string; content: string }) => Promise<void>;
  onClose: () => void;
  onBack: () => void;
  className?: string;
  style?: React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArtifactViewer({
  artifact,
  isSaving,
  onSaveArtifact,
  onClose,
  onBack,
  className,
  style,
}: ArtifactViewerProps) {
  const [title, setTitle] = useState(artifact.title);
  const [content, setContent] = useState(artifact.content);
  const [isEditing, setIsEditing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const copyTimeoutRef = useRef<number>(0);

  // Reset local state and return to view mode when the selected artifact changes
  useEffect(() => {
    setTitle(artifact.title);
    setContent(artifact.content);
    setIsEditing(false);
  }, [artifact.id, artifact.title, artifact.content]);

  // Cleanup copy timeout
  useEffect(() => () => { window.clearTimeout(copyTimeoutRef.current); }, []);

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

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setIsCopied(true);
      copyTimeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently fail
    }
  }, [artifact.content]);

  const resolvedExtension = useMemo(
    () => inferExtension(artifact.title, artifact.extension),
    [artifact.title, artifact.extension],
  );

  const rendererType = useMemo(
    () => getRendererType(resolvedExtension),
    [resolvedExtension],
  );

  return (
    <ArtifactShell
      className={cn("border-l rounded-none", className)}
      style={style}
    >
      {/* Header */}
      <ArtifactHeader>
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to artifact list">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <ArtifactTitle>
          {isEditing ? title : artifact.title}
        </ArtifactTitle>
        <ArtifactDescription>
          {getContentTypeLabel(resolvedExtension)}
        </ArtifactDescription>
        <ArtifactActions>
          <ArtifactAction
            icon={isCopied ? CheckIcon : CopyIcon}
            label="Copy content"
            tooltip="Copy"
            onClick={() => void handleCopy()}
          />
          {!isEditing && (
            <ArtifactAction
              icon={Pencil}
              label="Edit artifact"
              tooltip="Edit"
              onClick={() => setIsEditing(true)}
            />
          )}
        </ArtifactActions>
        <ArtifactClose onClick={onClose} />
      </ArtifactHeader>

      {/* Content */}
      <ArtifactContent className="p-0">
        {isEditing ? (
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
              className="min-h-0 flex-1 resize-none"
              disabled={isSaving}
            />
          </div>
        ) : (
          <ContentRenderer
            content={artifact.content}
            rendererType={rendererType}
            extension={resolvedExtension}
          />
        )}
      </ArtifactContent>

      {/* Footer */}
      <div className="flex items-center justify-between border-t px-4 py-2">
        <span className="text-xs text-muted-foreground">
          Updated {new Date(artifact.updatedAt).toLocaleTimeString()}
        </span>
        {isEditing && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={!hasUnsavedChanges || isSaving || title.trim().length === 0}
            >
              Save
            </Button>
          </div>
        )}
      </div>
    </ArtifactShell>
  );
}

// ---------------------------------------------------------------------------
// Content renderer — dispatches based on extension
// ---------------------------------------------------------------------------

function ContentRenderer({
  content,
  rendererType,
  extension,
}: {
  content: string;
  rendererType: RendererType;
  extension: string | null;
}) {
  if (!content.trim()) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        Empty artifact
      </div>
    );
  }

  switch (rendererType) {
    case "markdown":
      return (
        <div className="flex-1 overflow-auto p-4">
          <Streamdown
            className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            plugins={streamdownPlugins}
          >
            {content}
          </Streamdown>
        </div>
      );

    case "image":
      return (
        <div className="flex flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--color-muted)_0%_25%,transparent_0%_50%)_0_0/16px_16px] p-4">
          <img
            src={content.startsWith("data:") ? content : `data:image/${extension};base64,${content}`}
            alt="Artifact image"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );

    case "code":
      return (
        <div className="flex-1 overflow-auto">
          <CodeBlockContainer language={extension ?? "text"} className="border-0 rounded-none">
            <CodeBlockContent
              code={content}
              language={extensionToLanguage(extension)}
              showLineNumbers
            />
          </CodeBlockContainer>
        </div>
      );

    case "text":
    default:
      return (
        <div className="flex-1 overflow-auto">
          <CodeBlockContainer language="text" className="border-0 rounded-none">
            <CodeBlockContent
              code={content}
              language={"text" as BundledLanguage}
            />
          </CodeBlockContainer>
        </div>
      );
  }
}
