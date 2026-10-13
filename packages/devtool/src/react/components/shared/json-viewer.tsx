import { useEffect, useState } from "react";
import { Maximize2, X, Copy, Check } from "lucide-react";
import { cn } from "../../lib/utils";

type JsonViewerProps = {
  data: unknown;
  className?: string;
  maxInitialKeys?: number;
};

export function JsonViewer({ data, className, maxInitialKeys = 20 }: JsonViewerProps) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);

  if (text === undefined || text === null || text === "null" || text === "undefined") {
    return <span className="font-fs-mono text-[11px] text-fs-ink4 italic">null</span>;
  }

  const lines = text.split("\n");
  const [expanded, setExpanded] = useState(lines.length <= maxInitialKeys);
  const [dialogOpen, setDialogOpen] = useState(false);

  const displayLines = expanded ? lines : lines.slice(0, maxInitialKeys);
  const remaining = lines.length - maxInitialKeys;

  return (
    <>
      <div className={cn("relative group bg-fs-card border border-fs-ink/20 p-3 font-fs-mono text-[11.5px] leading-[1.55] overflow-auto", className)}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
          title="Open in dialog"
          className="absolute top-1.5 right-1.5 p-1 text-fs-ink4 hover:text-fs-ink hover:bg-fs-ink/5 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-fs-blue/40 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
        <pre className="whitespace-pre-wrap text-fs-ink2">
          {syntaxHighlight(displayLines.join("\n"))}
        </pre>
        {!expanded && remaining > 0 && (
          <button
            className="mt-1 text-[10.5px] text-fs-blue hover:text-fs-ink"
            onClick={() => setExpanded(true)}
          >
            ... ({remaining} more lines)
          </button>
        )}
      </div>
      {dialogOpen && (
        <JsonDialog text={text} onClose={() => setDialogOpen(false)} />
      )}
    </>
  );
}

/**
 * Full-screen overlay for inspecting long JSON / text payloads. Closes on
 * Esc or backdrop click. Body of the panel is scrollable so the syntax-
 * highlighted source can be read end-to-end without the surrounding
 * detail panel scrolling.
 */
function JsonDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-fs-ink/50 p-6"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-4xl max-h-[85vh] border border-fs-ink/30 bg-fs-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-fs-ink/20 px-4 py-2">
          <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">Value</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy"
              className="p-1.5 text-fs-ink4 hover:text-fs-ink hover:bg-fs-ink/5 focus-visible:ring-2 focus-visible:ring-fs-blue/40"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-fs-green" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="p-1.5 text-fs-ink4 hover:text-fs-ink hover:bg-fs-ink/5 focus-visible:ring-2 focus-visible:ring-fs-blue/40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 font-fs-mono text-[11.5px] leading-[1.55]">
          <pre className="whitespace-pre-wrap text-fs-ink2">
            {syntaxHighlight(text)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function syntaxHighlight(json: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /("(?:\\.|[^"\\])*")\s*:/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      parts.push(json.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={`k-${match.index}`} className="text-fs-ink3">
        {match[1]}
      </span>,
    );
    parts.push(":");
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < json.length) {
    parts.push(json.slice(lastIndex));
  }

  return parts;
}
