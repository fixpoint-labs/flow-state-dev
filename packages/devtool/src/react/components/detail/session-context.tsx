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
import { looseDeepEqual } from "@flow-state-dev/core/helpers";
import { ResourcesPanel } from "./resources-panel";

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

  // Count items and changes per section. Resources moved to the debug
  // ResourcesPanel; this aggregate now covers only client-data scopes.
  const stats = useMemo(() => {
    if (!snapshot) return null;
    return {
      clientData: sectionStats(snapshot.clientData, prevSnapshot?.clientData),
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

  const hasClientData = snapshot.clientData && Object.values(snapshot.clientData).some((v) => v && Object.keys(v).length > 0);

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

      {!hasClientData && !detail && (
        <EmptyState message="Session state is empty. Execute an action to populate state." />
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

      <ResourcesPanel sessionId={sessionId} refreshKey={refreshKey} />
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
        if (!prevData || !looseDeepEqual(data[key], prevData[key])) {
          changed++;
        }
      }
    }
  }
  return { count, changed };
}

