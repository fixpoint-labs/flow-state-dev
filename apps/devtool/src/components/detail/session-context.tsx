/**
 * Session context sidebar panel.
 * Structured key-value layout with copy buttons per scope.
 * Sections collapsed by default with count + change badges.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JsonViewer } from "@/components/shared/json-viewer";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { useSessionState } from "@/hooks/use-session-state";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { deepEqual } from "@/lib/utils";

type SessionContextPanelProps = {
  sessionId: string | null;
  refreshKey?: number;
};

export function SessionContextPanel({ sessionId, refreshKey }: SessionContextPanelProps) {
  const { snapshot, prevSnapshot, isLoading, error, lastFetchedAt, refresh } = useSessionState(sessionId);

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

      {!hasState && !hasClientData && !hasResources && (
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
          {snapshot.state.project && Object.keys(snapshot.state.project).length > 0 && (
            <ScopeBlock label="Project" data={snapshot.state.project} />
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
          {snapshot.clientData.project && Object.keys(snapshot.clientData.project).length > 0 && (
            <ScopeBlock label="Project" data={snapshot.clientData.project} />
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
          {snapshot.resources!.project && Object.keys(snapshot.resources!.project).length > 0 && (
            <ResourceScope label="Project" resources={snapshot.resources!.project} prevResources={prevSnapshot?.resources?.project} />
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
        {entries.map(([name, state]) => {
          const prev = prevResources?.[name];
          const changed = prev !== undefined && !deepEqual(state, prev);
          const isNew = prev === undefined && prevResources !== undefined;
          return (
            <ResourceItem
              key={name}
              name={name}
              state={state}
              changed={changed}
              isNew={isNew}
            />
          );
        })}
      </div>
    </div>
  );
}

function ResourceItem({
  name,
  state,
  changed,
  isNew,
}: {
  name: string;
  state: Record<string, unknown>;
  changed: boolean;
  isNew: boolean;
}) {
  const [open, setOpen] = useState(false);
  const stateKeys = Object.keys(state);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(JSON.stringify(state, null, 2));
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
        <span className="text-[11px] font-mono text-slate-400 truncate">{name}</span>
        <span className="text-[10px] font-mono text-slate-700">
          {stateKeys.length} {stateKeys.length === 1 ? "key" : "keys"}
        </span>
        {isNew && (
          <span className="text-[9px] font-mono text-green-500 bg-green-900/20 px-1 rounded-full">new</span>
        )}
        {changed && (
          <span className="text-[9px] font-mono text-amber-500 bg-amber-900/20 px-1 rounded-full">changed</span>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="icon-xs" onClick={handleCopy} title="Copy resource state">
          <Copy className="h-2.5 w-2.5 text-slate-700" />
        </Button>
      </button>
      {open && (
        <div className="pl-4 mt-0.5">
          <JsonViewer data={state} className="mt-0" />
        </div>
      )}
    </div>
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

