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
    return <span className="text-xs text-slate-500 italic">null</span>;
  }

  const lines = text.split("\n");
  const [expanded, setExpanded] = useState(lines.length <= maxInitialKeys);
  const [dialogOpen, setDialogOpen] = useState(false);

  const displayLines = expanded ? lines : lines.slice(0, maxInitialKeys);
  const remaining = lines.length - maxInitialKeys;

  return (
    <>
      <div className={cn("relative group rounded-md bg-slate-950 border border-slate-800 p-3 font-mono text-xs overflow-auto", className)}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
          title="Open in dialog"
          className="absolute top-1.5 right-1.5 p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
        <pre className="whitespace-pre-wrap text-slate-300">
          {syntaxHighlight(displayLines.join("\n"))}
        </pre>
        {!expanded && remaining > 0 && (
          <button
            className="mt-1 text-[10px] text-blue-400 hover:text-blue-300"
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-4xl max-h-[85vh] rounded-lg border border-slate-700 bg-slate-950 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">Value</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy"
              className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 font-mono text-xs">
          <pre className="whitespace-pre-wrap text-slate-300">
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
      <span key={`k-${match.index}`} className="text-blue-300">
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
