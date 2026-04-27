"use client";

/**
 * Modal artifact viewer/editor.
 *
 * Replaces the sidebar artifact panel: clicking an artifact opens this dialog
 * over the main layout. View mode renders markdown / code / image; Edit mode
 * presents a textarea with an AI Actions toolbar wired to the
 * `rich-text-component` flow. Each action streams its result into the editor,
 * replacing the current text selection (or the entire content if no selection
 * is active). Save writes back via the chat-agent `saveArtifact` action.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import {
  ArrowLeftIcon,
  CheckIcon,
  Code2,
  CopyIcon,
  Eye,
  Languages,
  type LucideIcon,
  Maximize2,
  PencilIcon,
  ScrollText,
  SparklesIcon,
  TypeIcon,
  UserCircle2,
  WandSparkles,
} from "lucide-react";
import type { BundledLanguage } from "shiki";
import { Streamdown } from "streamdown";

import {
  createClient,
  createSSEClientFromResponse,
  type RequestStreamHandle,
} from "@flow-state-dev/client";
import { useFlowContext } from "@flow-state-dev/react";

import {
  CodeBlockContainer,
  CodeBlockContent,
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

function inferExtension(title: string, storedExtension: string | null | undefined): string | null {
  // Title takes priority — users rename `.txt` → `.md` to switch renderers,
  // and the stored extension can lag behind the most recent rename.
  const dot = title.lastIndexOf(".");
  if (dot !== -1 && dot !== title.length - 1) {
    return title.slice(dot + 1).toLowerCase();
  }
  return storedExtension ? storedExtension.toLowerCase() : null;
}

function getRendererType(extension: string | null): RendererType {
  if (!extension) return "text";
  const ext = extension.toLowerCase();
  if (MARKDOWN_EXTS.has(ext)) return "markdown";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (CODE_EXTS.has(ext)) return "code";
  return "text";
}

function extensionToLanguage(extension: string | null): BundledLanguage {
  if (!extension) return "text" as BundledLanguage;
  const map: Record<string, string> = {
    ts: "typescript", js: "javascript", py: "python", sh: "bash",
    yml: "yaml", scss: "scss", rs: "rust", kt: "kotlin",
    rb: "ruby", cpp: "cpp", dockerfile: "dockerfile",
  };
  return (map[extension.toLowerCase()] ?? extension.toLowerCase()) as BundledLanguage;
}

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
// AI action registry
// ---------------------------------------------------------------------------

/**
 * Free-text inputs that the rich-text-component flow expects on top of
 * `text` for two of its actions. Captured inline via the action toolbar
 * before the action fires.
 */
type PendingInput =
  | { kind: "tone"; value: string }
  | { kind: "translate"; value: string }
  | null;

type AIActionId =
  | "copyedit"
  | "improve"
  | "summarize"
  | "expand"
  | "personalize"
  | "changeTone"
  | "translate"
  | "fixCode";

type AIAction = {
  id: AIActionId;
  label: string;
  tooltip: string;
  icon: LucideIcon;
  /** When defined, opens an inline input field for the second free-text param. */
  pendingKind?: "tone" | "translate";
};

const AI_ACTIONS: ReadonlyArray<AIAction> = [
  { id: "copyedit",    label: "Copyedit",    tooltip: "Fix grammar, spelling, and punctuation", icon: WandSparkles },
  { id: "improve",     label: "Improve",     tooltip: "Improve clarity and flow",                icon: SparklesIcon  },
  { id: "summarize",   label: "Summarize",   tooltip: "Summarize the text",                      icon: ScrollText    },
  { id: "expand",      label: "Expand",      tooltip: "Expand with more detail",                 icon: Maximize2     },
  { id: "personalize", label: "Personalize", tooltip: "Rewrite using your remembered context",   icon: UserCircle2   },
  { id: "changeTone",  label: "Tone",        tooltip: "Rewrite in a different tone",             icon: TypeIcon, pendingKind: "tone"      },
  { id: "translate",   label: "Translate",   tooltip: "Translate to another language",           icon: Languages, pendingKind: "translate" },
  { id: "fixCode",     label: "Fix Code",    tooltip: "Fix bugs and syntax errors in code",      icon: Code2         },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArtifactDetail = {
  id: string;
  title: string;
  content: string;
  extension: string | null;
  updatedAt: number;
};

/**
 * In-flight state for a streaming AI action. `prefix` and `suffix` are the
 * portions of the artifact content that flank the targeted range; the live
 * preview is `prefix + accumulated + suffix`. When the stream completes we
 * commit that string to `content`.
 */
type StreamState = {
  action: AIActionId;
  prefix: string;
  suffix: string;
  accumulated: string;
};

interface ArtifactDialogProps {
  /** When non-null, the dialog is open and renders this artifact. */
  artifact: ArtifactDetail | null;
  /** True while a save is in flight against the chat-agent flow. */
  isSaving: boolean;
  onSaveArtifact: (artifact: { id: string; title: string; content: string }) => Promise<void>;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArtifactDialog({ artifact, isSaving, onSaveArtifact, onClose }: ArtifactDialogProps) {
  return (
    <Dialog
      open={artifact !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {artifact !== null && (
        <ArtifactDialogBody
          key={artifact.id}
          artifact={artifact}
          isSaving={isSaving}
          onSaveArtifact={onSaveArtifact}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function ArtifactDialogBody({
  artifact,
  isSaving,
  onSaveArtifact,
  onClose,
}: {
  artifact: ArtifactDetail;
  isSaving: boolean;
  onSaveArtifact: (artifact: { id: string; title: string; content: string }) => Promise<void>;
  onClose: () => void;
}) {
  const ctx = useFlowContext();
  const userId = ctx.userId;
  const baseUrl = ctx.baseUrl;

  const [title, setTitle] = useState(artifact.title);
  const [content, setContent] = useState(artifact.content);
  const [isEditing, setIsEditing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [pendingInput, setPendingInput] = useState<PendingInput>(null);

  const copyTimeoutRef = useRef<number>(0);
  const handleRef = useRef<RequestStreamHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Remember the most recent non-empty selection so clicking a toolbar button
  // (which blurs the textarea) still targets the selected range.
  const lastSelectionRef = useRef<{ start: number; end: number } | null>(null);

  // Sync local state when the underlying artifact updates (e.g., another
  // session writes to the same key). Keeps content reactive without losing
  // user edits within the same artifact id.
  useEffect(() => {
    setTitle(artifact.title);
    setContent(artifact.content);
  }, [artifact.title, artifact.content]);

  useEffect(
    () => () => {
      window.clearTimeout(copyTimeoutRef.current);
      handleRef.current?.close();
      handleRef.current = null;
    },
    [],
  );

  const isStreaming = streamState !== null;
  const hasUnsavedChanges = title !== artifact.title || content !== artifact.content;

  const displayedContent = useMemo(() => {
    if (!streamState) return content;
    return streamState.prefix + streamState.accumulated + streamState.suffix;
  }, [content, streamState]);

  const resolvedExtension = useMemo(
    () => inferExtension(artifact.title, artifact.extension),
    [artifact.title, artifact.extension],
  );

  const rendererType = useMemo(
    () => getRendererType(resolvedExtension),
    [resolvedExtension],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      copyTimeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently fail.
    }
  }, [content]);

  const handleCancel = () => {
    if (isStreaming) {
      handleRef.current?.close();
      handleRef.current = null;
      setStreamState(null);
    }
    setTitle(artifact.title);
    setContent(artifact.content);
    setIsEditing(false);
    setStreamError(null);
    setPendingInput(null);
  };

  const handleSave = async () => {
    await onSaveArtifact({ id: artifact.id, title, content });
    setIsEditing(false);
    setStreamError(null);
    setPendingInput(null);
  };

  const handleSelectionCapture = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.selectionStart !== ta.selectionEnd) {
      lastSelectionRef.current = {
        start: ta.selectionStart,
        end: ta.selectionEnd,
      };
    }
  }, []);

  const runAction = useCallback(
    (actionId: AIActionId, extra: Record<string, unknown> = {}) => {
      if (isStreaming) return;
      if (!userId) {
        setStreamError("No user ID available — wrap the app in a FlowProvider.");
        return;
      }

      const ta = textareaRef.current;
      let start = 0;
      let end = 0;
      if (ta) {
        if (ta.selectionStart !== ta.selectionEnd) {
          start = ta.selectionStart;
          end = ta.selectionEnd;
        } else if (lastSelectionRef.current) {
          start = lastSelectionRef.current.start;
          end = lastSelectionRef.current.end;
        }
      }

      const useFullContent = start === end;
      const targetText = useFullContent ? content : content.slice(start, end);
      if (!targetText.trim()) {
        setStreamError("Select some text or fill the editor before running an action.");
        return;
      }

      const prefix = useFullContent ? "" : content.slice(0, start);
      const suffix = useFullContent ? "" : content.slice(end);

      setStreamError(null);
      lastSelectionRef.current = null;
      setStreamState({ action: actionId, prefix, suffix, accumulated: "" });

      const client = createClient({
        flowKind: "rich-text-component",
        userId,
        baseUrl,
      });

      const input = { text: targetText, ...extra };

      const finalize = (committed: string | null) => {
        handleRef.current?.close();
        handleRef.current = null;
        if (committed !== null) {
          setContent(prefix + committed + suffix);
        }
        setStreamState(null);
      };

      void (async () => {
        try {
          const response = await client.sendActionStream(actionId, input);
          let acc = "";
          let done = false;
          const handle = createSSEClientFromResponse({
            response,
            onContentDelta: (event) => {
              acc += event.delta;
              setStreamState((prev) =>
                prev && prev.action === actionId
                  ? { ...prev, accumulated: acc }
                  : prev,
              );
            },
            onRequestStatus: (event) => {
              if (done) return;
              if (event.status === "completed") {
                done = true;
                finalize(acc);
              } else if (
                event.status === "failed" ||
                event.status === "incomplete" ||
                event.status === "aborted"
              ) {
                done = true;
                setStreamError(`${actionLabelOf(actionId)} ${event.status}.`);
                finalize(null);
              }
            },
            onError: (error) => {
              if (done) return;
              done = true;
              setStreamError(error.message);
              finalize(null);
            },
          });
          handleRef.current = handle;
        } catch (err) {
          setStreamError(err instanceof Error ? err.message : String(err));
          setStreamState(null);
        }
      })();
    },
    [content, isStreaming, userId, baseUrl],
  );

  const handleActionClick = useCallback(
    (action: AIAction) => {
      if (action.pendingKind === undefined) {
        runAction(action.id);
        return;
      }
      handleSelectionCapture();
      setPendingInput({ kind: action.pendingKind, value: "" });
    },
    [runAction, handleSelectionCapture],
  );

  const handlePendingSubmit = useCallback(() => {
    if (!pendingInput) return;
    const trimmed = pendingInput.value.trim();
    if (trimmed.length === 0) return;
    if (pendingInput.kind === "tone") {
      runAction("changeTone", { tone: trimmed });
    } else {
      runAction("translate", { language: trimmed });
    }
    setPendingInput(null);
  }, [pendingInput, runAction]);

  // Block dismissal (Escape, click-outside) when streaming or when we have
  // unsaved edits in flight. The X / Close button bypasses these by calling
  // onClose() directly — same as the issue's "X" button.
  const blockDismiss = isStreaming || (isEditing && hasUnsavedChanges);

  return (
    <DialogContent
      showCloseButton={false}
      className={cn(
        "flex h-[85vh] max-h-[85vh] w-[90vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]",
      )}
      onEscapeKeyDown={(event) => {
        if (blockDismiss) event.preventDefault();
      }}
      onPointerDownOutside={(event) => {
        if (blockDismiss) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (blockDismiss) event.preventDefault();
      }}
    >
      <DialogTitle className="sr-only">
        {isEditing ? `Edit ${artifact.title}` : artifact.title}
      </DialogTitle>
      <DialogDescription className="sr-only">
        {getContentTypeLabel(resolvedExtension)} artifact viewer
      </DialogDescription>

      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <span className="flex-1 truncate text-sm font-semibold">
          {isEditing ? title : artifact.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {getContentTypeLabel(resolvedExtension)}
        </span>
        <div className="flex items-center gap-1">
          <ToolbarIconButton
            icon={isCopied ? CheckIcon : CopyIcon}
            label="Copy content"
            tooltip="Copy"
            onClick={() => void handleCopy()}
          />
          {!isEditing ? (
            <ToolbarIconButton
              icon={PencilIcon}
              label="Edit artifact"
              tooltip="Edit"
              onClick={() => setIsEditing(true)}
            />
          ) : (
            <ToolbarIconButton
              icon={Eye}
              label="Preview artifact"
              tooltip="Preview"
              onClick={handleCancel}
              disabled={isStreaming}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isStreaming}
            aria-label="Close dialog"
          >
            Close
          </Button>
        </div>
      </header>

      {isEditing && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted/30 px-3 py-2">
          {pendingInput === null ? (
            <>
              {AI_ACTIONS.map((action) => (
                <ActionPillButton
                  key={action.id}
                  icon={action.icon}
                  label={action.label}
                  tooltip={action.tooltip}
                  isActive={streamState?.action === action.id}
                  disabled={isStreaming || isSaving}
                  onClick={() => handleActionClick(action)}
                />
              ))}
            </>
          ) : (
            <PendingInputForm
              kind={pendingInput.kind}
              value={pendingInput.value}
              onChange={(value) => setPendingInput({ kind: pendingInput.kind, value })}
              onCancel={() => setPendingInput(null)}
              onSubmit={handlePendingSubmit}
            />
          )}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {isStreaming && (
              <span className="flex items-center gap-1">
                <Spinner className="size-3" />
                Streaming {actionLabelOf(streamState!.action).toLowerCase()}…
              </span>
            )}
            {streamError && !isStreaming && (
              <span className="text-destructive">{streamError}</span>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isEditing ? (
          <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
            <Input
              aria-label="Artifact title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSaving || isStreaming}
            />
            <Textarea
              ref={textareaRef}
              aria-label="Artifact content"
              value={displayedContent}
              onChange={(e) => {
                if (isStreaming) return;
                setContent(e.target.value);
              }}
              onMouseUp={handleSelectionCapture}
              onKeyUp={handleSelectionCapture}
              onBlur={handleSelectionCapture}
              className="min-h-0 flex-1 resize-none font-mono text-sm"
              disabled={isSaving || isStreaming}
              readOnly={isStreaming}
            />
          </div>
        ) : (
          <ContentRenderer
            content={content}
            rendererType={rendererType}
            extension={resolvedExtension}
          />
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5">
        <span className="text-xs text-muted-foreground">
          Updated {new Date(artifact.updatedAt).toLocaleTimeString()}
        </span>
        {isEditing ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={
                !hasUnsavedChanges ||
                isSaving ||
                isStreaming ||
                title.trim().length === 0
              }
            >
              Save
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
          >
            <PencilIcon className="mr-1 size-3.5" /> Edit
          </Button>
        )}
      </footer>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ToolbarIconButton({
  icon: Icon,
  label,
  tooltip,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
          >
            <Icon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ActionPillButton({
  icon: Icon,
  label,
  tooltip,
  onClick,
  disabled,
  isActive,
}: {
  icon: LucideIcon;
  label: string;
  tooltip: string;
  onClick: () => void;
  disabled: boolean;
  isActive: boolean;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant={isActive ? "default" : "outline"}
            className={cn("h-7 gap-1.5 rounded-full px-2.5 text-xs")}
            onClick={onClick}
            disabled={disabled}
          >
            <Icon className="size-3.5" />
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PendingInputForm({
  kind,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  kind: "tone" | "translate";
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const placeholder = kind === "tone"
    ? "e.g. formal, friendly, sarcastic"
    : "e.g. Spanish, Japanese, fr-CA";
  const label = kind === "tone" ? "Change tone to" : "Translate to";
  return (
    <form
      className="flex w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Cancel"
        onClick={onCancel}
      >
        <ArrowLeftIcon className="size-4" />
      </Button>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 max-w-[260px] text-sm"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <Button
        type="submit"
        size="sm"
        className="h-7"
        disabled={value.trim().length === 0}
      >
        Apply
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Content renderer — dispatches based on extension (view mode only)
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
          <CodeBlockContainer language={extension ?? "text"} className="rounded-none border-0">
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
          <CodeBlockContainer language="text" className="rounded-none border-0">
            <CodeBlockContent
              code={content}
              language={"text" as BundledLanguage}
            />
          </CodeBlockContainer>
        </div>
      );
  }
}

function actionLabelOf(id: AIActionId): string {
  return AI_ACTIONS.find((a) => a.id === id)?.label ?? id;
}
