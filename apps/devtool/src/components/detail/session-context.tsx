import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JsonViewer } from "@/components/shared/json-viewer";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { useSessionState } from "@/hooks/use-session-state";
import { useRelativeTime } from "@/hooks/use-relative-time";

type SessionContextPanelProps = {
  sessionId: string | null;
};

export function SessionContextPanel({ sessionId }: SessionContextPanelProps) {
  const { snapshot, isLoading, error, lastFetchedAt, refresh } = useSessionState(sessionId);
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
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={refresh} title="Refresh state">
            <RefreshCw className={`h-3 w-3 text-slate-500 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {!hasState && !hasClientData && (
        <EmptyState message="Session state is empty. Execute an action to populate state." />
      )}

      {snapshot.state.session && Object.keys(snapshot.state.session).length > 0 && (
        <CollapsibleSection title="Session State" defaultOpen>
          <JsonViewer data={snapshot.state.session} />
        </CollapsibleSection>
      )}

      {snapshot.state.user && Object.keys(snapshot.state.user).length > 0 && (
        <CollapsibleSection title="User State" defaultOpen={false}>
          <JsonViewer data={snapshot.state.user} />
        </CollapsibleSection>
      )}

      {snapshot.state.project && Object.keys(snapshot.state.project).length > 0 && (
        <CollapsibleSection title="Project State" defaultOpen={false}>
          <JsonViewer data={snapshot.state.project} />
        </CollapsibleSection>
      )}

      {hasClientData && (
        <CollapsibleSection title="Projections" defaultOpen>
          {snapshot.clientData.session && Object.keys(snapshot.clientData.session).length > 0 && (
            <div className="mb-2">
              <span className="text-[10px] text-slate-600 uppercase">Session Scope</span>
              <JsonViewer data={snapshot.clientData.session} className="mt-1" />
            </div>
          )}
          {snapshot.clientData.user && Object.keys(snapshot.clientData.user).length > 0 && (
            <div className="mb-2">
              <span className="text-[10px] text-slate-600 uppercase">User Scope</span>
              <JsonViewer data={snapshot.clientData.user} className="mt-1" />
            </div>
          )}
          {snapshot.clientData.project && Object.keys(snapshot.clientData.project).length > 0 && (
            <div>
              <span className="text-[10px] text-slate-600 uppercase">Project Scope</span>
              <JsonViewer data={snapshot.clientData.project} className="mt-1" />
            </div>
          )}
        </CollapsibleSection>
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
