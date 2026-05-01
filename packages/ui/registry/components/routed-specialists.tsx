"use client";

import type { ComponentItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  Loader2Icon,
  UserIcon,
} from "lucide-react";
import Markdown from "react-markdown";

type RoutedSpecialistsData = {
  state: Record<string, unknown>;
  iteration: number;
  specialist: string | null;
  done: boolean;
};

/**
 * Renders a routedSpecialists pattern component item — showing the shared
 * workspace state that specialists have written to across iterations.
 */
export function RoutedSpecialists({ item }: { item: ComponentItem }) {
  const data = item.data as RoutedSpecialistsData;
  const { state, iteration, specialist } = data;

  const isFinished = item.status === "completed";

  const entries = Object.entries(state).filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );

  const populatedCount = entries.length;
  const totalKeys = Object.keys(state).length;

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ClipboardListIcon className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
          <p className="text-sm font-medium leading-snug">Routed Specialists</p>
        </div>
        <div className="flex items-center gap-2">
          {specialist && !isFinished && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <UserIcon className="h-2.5 w-2.5" aria-hidden="true" />
              {specialist}
            </span>
          )}
          <span className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground tabular-nums">
            {isFinished ? (
              <CheckCircle2Icon className="h-3 w-3 text-emerald-500" aria-hidden="true" />
            ) : (
              <Loader2Icon className="h-3 w-3 animate-spin text-blue-500" aria-hidden="true" />
            )}
            {iteration > 0
              ? `${populatedCount}/${totalKeys} · iter ${iteration}`
              : `${populatedCount}/${totalKeys}`}
          </span>
        </div>
      </div>

      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.map(([key, value]) => (
            <WorkspaceEntry key={key} label={key} value={value} />
          ))}
        </ul>
      )}

      {entries.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No entries yet</p>
      )}
    </div>
  );
}

function WorkspaceEntry({ label, value }: { label: string; value: unknown }) {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);

  const isLong = text.length > 120;

  if (!isLong) {
    return (
      <li className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {label}
        </span>
        <span className="text-xs leading-snug">
          <EntryMarkdown text={text} />
        </span>
      </li>
    );
  }

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2">
          <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {label}
          </span>
          <span className="flex-1 truncate text-xs leading-snug text-muted-foreground">
            {text.slice(0, 100)}…
          </span>
          <ChevronRightIcon
            className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-1.5 pl-5">
          <EntryMarkdown text={text} />
        </div>
      </details>
    </li>
  );
}

const headingComponent = ({ children }: { children?: React.ReactNode }) => (
  <p className="font-semibold">{children}</p>
);
const markdownComponents = {
  h1: headingComponent,
  h2: headingComponent,
  h3: headingComponent,
  h4: headingComponent,
  h5: headingComponent,
  h6: headingComponent,
};

function EntryMarkdown({ text }: { text: string }) {
  return (
    <div className={cn(
      "prose-none text-xs leading-snug text-muted-foreground",
      "[&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5",
      "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[10px]",
      "[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2",
      "[&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-2 [&_blockquote]:italic",
    )}>
      <Markdown components={markdownComponents}>{text}</Markdown>
    </div>
  );
}
