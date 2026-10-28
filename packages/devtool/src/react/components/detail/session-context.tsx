/**
 * Session context sidebar panel.
 * Structured key-value layout with copy buttons per scope.
 * Sections collapsed by default with count + change badges.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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

  // Refresh when the parent signals a state change (e.g. after a stream
  // completes) — on a REAL change to the key, not merely on this effect running.
  //
  // The old condition (`refreshKey > 0`) also fired on mount and whenever
  // `refresh` changed identity, which duplicated the read the hook had already
  // issued. That was invisible while this panel mounted once per session; now
  // that it remounts with each workspace visit, it was a duplicate state read
  // on every switch. Comparing the value is the fix (BP-010: signal only on a
  // real change).
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === lastRefreshKey.current) return;
    lastRefreshKey.current = refreshKey;
    void refresh();
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
        <div className="h-6 animate-pulse bg-fs-ink/8" />
        <div className="h-20 animate-pulse bg-fs-ink/8" />
      </div>
    );
  }

  if (!snapshot) {
    return <EmptyState message="Session state is empty. Execute an action to populate state." />;
  }

  const hasClientData = snapshot.clientData && Object.values(snapshot.clientData).some((v) => v && Object.keys(v).length > 0);

  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">
          Session Context
        </span>
        <div className="flex items-center gap-1.5">
          <span className="font-fs-mono text-[10px] text-fs-ink4">{relativeTime}</span>
          <Button variant="ghost" size="icon-xs" onClick={refresh} title="Refresh state">
            <RefreshCw className={`h-3 w-3 text-fs-ink3 ${isLoading ? "animate-spin" : ""}`} />
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

      {/* Resources reads as its own inspector section: a full-bleed hairline
          matching the rail's section dividers (the rail pads children px-4). */}
      <div className="-mx-4 mt-3.5 border-t border-fs-ink/20 px-4 pt-3.5">
        <ResourcesPanel sessionId={sessionId} refreshKey={refreshKey} />
      </div>
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
        <span className="font-fs-mono text-[10px] uppercase tracking-[.12em] text-fs-ink4">{label}</span>
        <Button variant="ghost" size="icon-xs" onClick={handleCopy} title="Copy scope data">
          <Copy className="h-2.5 w-2.5 text-fs-ink3" />
        </Button>
      </div>
      {allPrimitive ? (
        <div className="space-y-0.5 border border-fs-ink/20 bg-fs-card px-2.5 py-1.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-start justify-between gap-2.5 font-fs-mono text-[11px] font-medium">
              <span className="shrink-0 text-fs-ink3">{key}</span>
              <span className="break-all text-right text-fs-ink2">
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
        className="flex w-full items-center gap-1.5 py-1.5 text-left text-[13px] text-fs-ink hover:text-fs-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fs-blue/40"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0 text-fs-ink3" /> : <ChevronRight className="h-3 w-3 shrink-0 text-fs-ink3" />}
        <span className="flex-1 truncate">{title}</span>
        {changed !== undefined && changed > 0 && (
          <span className="font-fs-mono text-[10.5px] text-fs-blue">
            {changed} changed
          </span>
        )}
        {count !== undefined && count > 0 && (
          <span className="font-fs-mono text-[10.5px] text-fs-ink4">
            {count}
          </span>
        )}
      </button>
      {open && <div className="mb-1.5 pl-4">{children}</div>}
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
      <div className="space-y-1 border border-fs-ink/20 bg-fs-card px-2.5 py-1.5 font-fs-mono text-[11px] font-medium">
        {entries.map(({ label, value }) => (
          <div key={label} className="flex items-start justify-between gap-2.5">
            <span className="shrink-0 text-fs-ink3">{label}</span>
            <span className="break-all text-right text-fs-ink2">{String(value)}</span>
          </div>
        ))}
        {hasTags && (
          <div className="flex items-start justify-between gap-2.5">
            <span className="shrink-0 text-fs-ink3">tags</span>
            <div className="flex flex-wrap gap-1 justify-end">
              {detail.tags!.map((tag) => (
                <span
                  key={tag}
                  className="border border-fs-ink/45 px-1 text-[9.5px] uppercase tracking-[.08em] text-fs-ink3"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
        {hasMetadata && (
          <div>
            <span className="text-fs-ink3">metadata</span>
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

