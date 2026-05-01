/**
 * Session context sidebar panel.
 * Structured key-value layout with copy buttons per scope.
 * Sections collapsed by default with count + change badges.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Copy } from "lucide-react";
import { Button } from "../ui/button";
import { JsonViewer } from "../shared/json-viewer";
import { EmptyState } from "../shared/empty-state";
import { ErrorAlert } from "../shared/error-alert";
import type { SessionDetail } from "@flow-state-dev/client";
import { useSessionState } from "../../hooks/use-session-state";
import { useRelativeTime } from "../../hooks/use-relative-time";
import { deepEqual } from "../../lib/utils";

type SessionContextPanelProps = {
  sessionId: string | null;
  refreshKey?: number;
};

export function SessionContextPanel({ sessionId, refreshKey }: SessionContextPanelProps) {
  const { snapshot, prevSnapshot, detail, isLoading, error, lastFetchedAt, refresh } = useSessionState(sessionId);

  // Refresh when parent signals a state change (e.g., after stream completes)
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      void refresh();
    }
  }, [refreshKey, refresh]);

  const relativeTime = useRelativeTime(lastFetchedAt);

  // Count items and changes per section.
  const stats = useMemo(() => {
    if (!snapshot) return null;
    return {
      state: sectionStats(snapshot.state, prevSnapshot?.state),
      clientData: sectionStats(snapshot.clientData, prevSnapshot?.clientData),
      resources: sectionStats(snapshot.resources, prevSnapshot?.resources),
    };
  }, [snapshot, prevSnapshot]);

  if (!sessionId) {
    return <EmptyState message="Select a session to view its state." />;
  }

  if (error) {
    return <ErrorAlert message={error} onRetry={refresh} />;
  }

  if (isLoading && !snapshot) {
    return (
      <div className="space-y-2 p-2">
        <div className="h-6 animate-pulse rounded bg-slate-800/50" />
        <div className="h-20 animate-pulse rounded bg-slate-800/50" />
      </div>
    );
  }

  if (!snapshot) {
    return <EmptyState message="Session state is empty. Execute an action to populate state." />;
  }

  const hasState = snapshot.state && Object.values(snapshot.state).some((v) => v && Object.keys(v).length > 0);
  const hasClientData = snapshot.clientData && Object.values(snapshot.clientData).some((v) => v && Object.keys(v).length > 0);
  const hasResources = snapshot.resources && Object.values(snapshot.resources).some((v) => v && Object.keys(v).length > 0);

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase text-slate-500">Session Context</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-600">{relativeTime}</span>
          <Button variant="ghost" size="icon-xs" onClick={refresh} title="Refresh state">
            <RefreshCw className={`h-3 w-3 text-slate-500 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {detail && (
        <SessionMetadataSection detail={detail} />
      )}

      {!hasState && !hasClientData && !hasResources && !detail && (
        <EmptyState message="Session state is empty. Execute an action to populate state." />
      )}

      {hasState && (
        <CollapsibleSection title="Server State" count={stats?.state.count} changed={stats?.state.changed}>
          {snapshot.state.session && Object.keys(snapshot.state.session).length > 0 && (
            <ScopeBlock label="Session" data={snapshot.state.session} />
          )}
          {snapshot.state.user && Object.keys(snapshot.state.user).length > 0 && (
            <ScopeBlock label="User" data={snapshot.state.user} />
          )}
          {snapshot.state.org && Object.keys(snapshot.state.org).length > 0 && (
            <ScopeBlock label="Org" data={snapshot.state.org} />
          )}
          {snapshot.state.request && Object.keys(snapshot.state.request).length > 0 && (
            <ScopeBlock label="Request" data={snapshot.state.request} />
          )}
        </CollapsibleSection>
      )}

      {hasClientData && (
        <CollapsibleSection title="Client Data" count={stats?.clientData.count} changed={stats?.clientData.changed}>
          {snapshot.clientData.session && Object.keys(snapshot.clientData.session).length > 0 && (
            <ScopeBlock label="Session" data={snapshot.clientData.session} />
          )}
          {snapshot.clientData.user && Object.keys(snapshot.clientData.user).length > 0 && (
            <ScopeBlock label="User" data={snapshot.clientData.user} />
          )}
          {snapshot.clientData.org && Object.keys(snapshot.clientData.org).length > 0 && (
            <ScopeBlock label="Org" data={snapshot.clientData.org} />
          )}
        </CollapsibleSection>
      )}

      {hasResources && (
        <CollapsibleSection title="Resources" count={stats?.resources.count} changed={stats?.resources.changed}>
          {snapshot.resources!.session && Object.keys(snapshot.resources!.session).length > 0 && (
            <ResourceScope label="Session" resources={snapshot.resources!.session} prevResources={prevSnapshot?.resources?.session} />
          )}
          {snapshot.resources!.user && Object.keys(snapshot.resources!.user).length > 0 && (
            <ResourceScope label="User" resources={snapshot.resources!.user} prevResources={prevSnapshot?.resources?.user} />
          )}
          {snapshot.resources!.org && Object.keys(snapshot.resources!.org).length > 0 && (
            <ResourceScope label="Org" resources={snapshot.resources!.org} prevResources={prevSnapshot?.resources?.org} />
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}

function ScopeBlock({ label, data }: { label: string; data: Record<string, unknown> }) {
  const handleCopy = () => {
    void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  const entries = Object.entries(data);
  const allPrimitive = entries.every(([, v]) => typeof v !== "object" || v === null);

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-600 uppercase">{label}</span>
        <Button variant="ghost" size="icon-xs" onClick={handleCopy} title="Copy scope data">
          <Copy className="h-2.5 w-2.5 text-slate-600" />
        </Button>
      </div>
      {allPrimitive ? (
        <div className="space-y-0.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-start justify-between gap-2">
              <span className="text-slate-500 shrink-0 font-mono text-[11px]">{key}</span>
              <span className="text-slate-300 text-right break-all text-[11px]">
                {value === null ? "null" : String(value)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <JsonViewer data={data} className="mt-0.5" />
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  changed,
  children,
}: {
  title: string;
  count?: number;
  changed?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left py-1"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />}
        <span className="text-xs font-medium text-slate-400">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] font-mono text-slate-600 bg-slate-800/60 px-1.5 rounded-full">
            {count}
          </span>
        )}
        {changed !== undefined && changed > 0 && (
          <span className="text-[10px] font-mono text-amber-500 bg-amber-900/20 px-1.5 rounded-full">
            {changed} changed
          </span>
        )}
      </button>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
}

function ResourceScope({
  label,
  resources,
  prevResources,
}: {
  label: string;
  resources: Record<string, Record<string, unknown>>;
  prevResources?: Record<string, Record<string, unknown>>;
}) {
  const entries = Object.entries(resources);
  if (entries.length === 0) return null;

  return (
    <div className="mb-2">
      <span className="text-[10px] text-slate-600 uppercase">{label}</span>
      <div className="mt-0.5 space-y-0.5">
        {entries.map(([name, entry]) => {
          const prev = prevResources?.[name];
          const changed = prev !== undefined && !deepEqual(entry, prev);
          const isNew = prev === undefined && prevResources !== undefined;
          return (
            <ResourceItem
              key={name}
              name={name}
              entry={entry ?? {}}
              changed={changed}
              isNew={isNew}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Sum "records" across a single-resource state body. Arrays contribute their
 * length (so an empty array is 0); scalars contribute 1 when non-zero / non-
 * nullish, 0 otherwise; nested objects contribute 1 if they have any keys.
 *
 * The intent is "how much actual data lives here", not "how many top-level
 * fields are declared" — useful for resources whose state is mostly a single
 * collection field plus a couple of counters.
 */
function countRecords(data: Record<string, unknown>): number {
  let total = 0;
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      total += value.length;
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof value === "number" && value === 0) continue;
    if (typeof value === "boolean" && value === false) continue;
    if (typeof value === "string" && value.length === 0) continue;
    if (typeof value === "object") {
      total += Object.keys(value as Record<string, unknown>).length > 0 ? 1 : 0;
      continue;
    }
    total += 1;
  }
  return total;
}

/**
 * Snapshot entries arrive as wrappers, never raw state — single resources are
 * `{ clientData?, content?, internal? }`, collections are `{ items, internal? }`.
 * Unwrap so the displayed body and key count reflect actual data, not envelope.
 */
function unwrapResourceEntry(entry: Record<string, unknown>): {
  data: unknown;
  isCollection: boolean;
  hasContent: boolean;
  isInternal: boolean;
} {
  const isInternal = entry.internal === true;
  if ("items" in entry) {
    const items = entry.items;
    return {
      data: items,
      isCollection: true,
      hasContent: false,
      isInternal,
    };
  }
  return {
    data: entry.clientData,
    isCollection: false,
    hasContent: entry.content !== undefined,
    isInternal,
  };
}

function ResourceItem({
  name,
  entry,
  changed,
  isNew,
}: {
  name: string;
  entry: Record<string, unknown>;
  changed: boolean;
  isNew: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data, isCollection, hasContent, isInternal } = unwrapResourceEntry(entry);

  // For collections: count items in the map.
  // For single resources: sum across top-level fields where arrays contribute
  // their length and scalars contribute 1 if non-zero/non-null. This gives a
  // "how much is actually in here" reading rather than just field count
  // (e.g. { observations: [a,b,c], turnCounter: 5 } → 4 records, not 2 fields).
  const itemCount = isCollection && data && typeof data === "object"
    ? Object.keys(data as Record<string, unknown>).length
    : null;
  const recordCount = !isCollection && data && typeof data === "object"
    ? countRecords(data as Record<string, unknown>)
    : null;
  const countLabel = isCollection
    ? itemCount !== null
      ? `${itemCount} ${itemCount === 1 ? "item" : "items"}`
      : null
    : recordCount !== null
      ? `${recordCount} ${recordCount === 1 ? "record" : "records"}`
      : null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(JSON.stringify(data ?? {}, null, 2));
  };

  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left py-0.5 hover:bg-slate-800/30 rounded px-1 -mx-1"
        onClick={() => setOpen(!open)}
      >
        {open
          ? <ChevronDown className="h-2.5 w-2.5 text-slate-600 shrink-0" />
          : <ChevronRight className="h-2.5 w-2.5 text-slate-600 shrink-0" />}
        <span className={`text-[11px] font-mono truncate ${isInternal ? "text-slate-500 italic" : "text-slate-400"}`}>
          {name}
        </span>
        {countLabel !== null && (
          <span className="text-[10px] font-mono text-slate-700">{countLabel}</span>
        )}
        {hasContent && (
          <span
            className="text-[9px] font-mono text-slate-500 bg-slate-800/40 px-1 rounded-full"
            title="Resource also has prefetched content (not shown — see network response)"
          >
            +content
          </span>
        )}
        {isInternal && (
          <span
            className="text-[9px] font-mono text-slate-500 bg-slate-800/40 px-1 rounded-full"
            title="No client config — raw state shown for development. Production clients don't see this resource in the snapshot."
          >
            internal
          </span>
        )}
        {isNew && (
          <span className="text-[9px] font-mono text-green-500 bg-green-900/20 px-1 rounded-full">new</span>
        )}
        {changed && (
          <span className="text-[9px] font-mono text-amber-500 bg-amber-900/20 px-1 rounded-full">changed</span>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="icon-xs" onClick={handleCopy} title="Copy resource data">
          <Copy className="h-2.5 w-2.5 text-slate-700" />
        </Button>
      </button>
      {open && (
        <div className="pl-4 mt-0.5">
          <JsonViewer data={data ?? {}} className="mt-0" />
        </div>
      )}
    </div>
  );
}

function SessionMetadataSection({ detail }: { detail: SessionDetail }) {
  const hasTitle = detail.title !== undefined && detail.title.length > 0;
  const hasDescription = detail.description !== undefined && detail.description.length > 0;
  const hasTags = detail.tags !== undefined && detail.tags.length > 0;
  const hasMetadata = detail.metadata !== undefined && Object.keys(detail.metadata).length > 0;

  if (!hasTitle && !hasDescription && !hasTags && !hasMetadata) {
    return null;
  }

  const entries: Array<{ label: string; value: React.ReactNode }> = [];

  if (hasTitle) {
    entries.push({ label: "title", value: detail.title });
  }
  if (hasDescription) {
    entries.push({ label: "description", value: detail.description });
  }

  return (
    <CollapsibleSection title="Session Metadata" count={entries.length + (hasTags ? 1 : 0) + (hasMetadata ? 1 : 0)}>
      <div className="space-y-1">
        {entries.map(({ label, value }) => (
          <div key={label} className="flex items-start justify-between gap-2">
            <span className="text-slate-500 shrink-0 font-mono text-[11px]">{label}</span>
            <span className="text-slate-300 text-right break-all text-[11px]">{String(value)}</span>
          </div>
        ))}
        {hasTags && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-slate-500 shrink-0 font-mono text-[11px]">tags</span>
            <div className="flex flex-wrap gap-1 justify-end">
              {detail.tags!.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] font-mono text-sky-400 bg-sky-900/20 px-1.5 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
        {hasMetadata && (
          <div>
            <span className="text-slate-500 font-mono text-[11px]">metadata</span>
            <JsonViewer data={detail.metadata!} className="mt-0.5" />
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// Helpers for counting keys and detecting changes between snapshots
// ---------------------------------------------------------------------------

type ScopeData = Record<string, unknown> | undefined;
type SectionData = Record<string, ScopeData> | undefined;

function sectionStats(
  current: SectionData,
  previous: SectionData,
): { count: number; changed: number } {
  if (!current) return { count: 0, changed: 0 };
  let count = 0;
  let changed = 0;
  for (const [scope, data] of Object.entries(current)) {
    if (!data) continue;
    const keys = Object.keys(data);
    count += keys.length;
    if (previous) {
      const prevData = previous[scope] as ScopeData;
      for (const key of keys) {
        if (!prevData || !deepEqual(data[key], prevData[key])) {
          changed++;
        }
      }
    }
  }
  return { count, changed };
}

