import { useState } from "react";
import { cn } from "@/lib/utils";

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

  const displayLines = expanded ? lines : lines.slice(0, maxInitialKeys);
  const remaining = lines.length - maxInitialKeys;

  return (
    <div className={cn("rounded-md bg-slate-950 border border-slate-800 p-3 font-mono text-xs overflow-auto", className)}>
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
  );
}

function syntaxHighlight(json: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /("(?:\\.|[^"\\])*")\s*:/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      parts.push(highlightValues(json.slice(lastIndex, match.index)));
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
    parts.push(highlightValues(json.slice(lastIndex)));
  }

  return parts;
}

function highlightValues(text: string): React.ReactNode {
  return text.replace(/("(?:\\.|[^"\\])*")|(\b\d+\.?\d*\b)|(true|false|null)/g, (m, str, num, bool) => {
    if (str) return m;
    if (num) return m;
    if (bool) return m;
    return m;
  });
}
