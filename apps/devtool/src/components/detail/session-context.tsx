/**
 * Session context sidebar panel.
 * Structured key-value layout with copy buttons per scope.
 * Replaces raw JSON dump with readable accordion sections.
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JsonViewer } from "@/components/shared/json-viewer";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { useSessionState } from "@/hooks/use-session-state";
import { useRelativeTime } from "@/hooks/use-relative-time";

type SessionContextPanelProps = {
  sessionId: string | null;
  refreshKey?: number;
};

export function SessionContextPanel({ sessionId, refreshKey }: SessionContextPanelProps) {
  const { snapshot, isLoading, error, lastFetchedAt, refresh } = useSessionState(sessionId);

  // Refresh when parent signals a state change (e.g., after stream completes)
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      void refresh();
    }
  }, [refreshKey, refresh]);

  const relativeTime = useRelativeTime(lastFetchedAt);

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

      {!hasState && !hasClientData && (
        <EmptyState message="Session state is empty. Execute an action to populate state." />
      )}

      {hasState && (
        <CollapsibleSection title="Server State" defaultOpen>
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
        <CollapsibleSection title="Client Data" defaultOpen>
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
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left py-1"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />}
        <span className="text-xs font-medium text-slate-400">{title}</span>
      </button>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
}
