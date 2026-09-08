/**
 * One flow instance in the navigator: its identity row, and — when open — its
 * own sessions and declared actions.
 *
 * The row's label is the instance ID, because that is what identifies the copy;
 * the kind is shown beside it, muted, only when the two differ (a singleton's id
 * IS its kind, and doubling it says nothing). A long id truncates visually, so
 * the full value stays reachable through the row's title and a copy button —
 * truncated text is not an identity, and neither is a row's position.
 */
import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Plus, RefreshCw } from "lucide-react";
import type { FlowListEntry } from "@flow-state-dev/client";
import { Button } from "../ui/button";
import { useDevTool } from "../../context/devtool-context";
import { useSessions } from "../../hooks/use-sessions";
import { SessionRow } from "./session-row";
import { ErrorAlert } from "../shared/error-alert";


type FlowItemProps = {
  flow: FlowListEntry;
  isActive: boolean;
  onSelect: () => void;
  sessionRefreshKey?: number;
  /** Also bring the open session current when the Sessions ⟳ is clicked. */
  onRefreshActiveSession?: () => void;
};

export function FlowItem({ flow, isActive, onSelect, sessionRefreshKey, onRefreshActiveSession }: FlowItemProps) {
  // Session selection lives in the provider, which moves instance and session
  // together. This row reports a pick; it does not keep a second copy of the
  // answer — two authorities over one selection is how the panel and the
  // navigator came to disagree about which session was open.
  const { activeSessionId, selectSession } = useDevTool();
  const { sessions, isLoading, error, refresh, createSession } = useSessions(isActive ? flow : null);

  // Refresh session list when parent signals metadata changed (e.g. title update via SSE)
  useEffect(() => {
    if (isActive && sessionRefreshKey && sessionRefreshKey > 0) {
      void refresh();
    }
  }, [sessionRefreshKey, isActive, refresh]);

  const handleCreateSession = async () => {
    const newId = await createSession();
    if (newId) {
      selectSession(newId);
    }
  };

  return (
    <div role="listitem">
      <button
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-800/60"
        onClick={onSelect}
        aria-expanded={isActive}
        aria-current={isActive ? "true" : undefined}
        // Spelled out, because the visible label runs the id and the kind
        // together with only styling between them — "engineer-aengineer" to
        // anything reading the accessible name, which is the one place the two
        // copies have to be tellable apart without looking.
        aria-label={
          flow.id === flow.kind
            ? `Flow instance ${flow.id}`
            : `Flow instance ${flow.id}, kind ${flow.kind}`
        }
        title={
          flow.id === flow.kind
            ? `Flow instance: ${flow.id}`
            : `Flow instance: ${flow.id}\nKind: ${flow.kind}`
        }
      >
        {isActive ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        )}
        <span className="flex-1 truncate font-medium">
          {flow.id}
          {flow.id !== flow.kind && (
            <span className="ml-1.5 font-normal text-slate-500">{flow.kind}</span>
          )}
        </span>
      </button>

      {isActive && (
        <div className="ml-3 border-l border-slate-800 pl-2">
          <div className="flex items-center gap-1 py-1">
            <span className="flex-1 truncate text-[10px] font-medium uppercase text-slate-500">
              Sessions
            </span>
            <CopyInstanceId flowId={flow.id} />
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => {
                void refresh();
                onRefreshActiveSession?.();
              }}
              title="Refresh sessions"
            >
              <RefreshCw className={`h-3 w-3 text-slate-500 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={handleCreateSession} title="New session">
              <Plus className="h-3 w-3 text-slate-500" />
            </Button>
          </div>

          {error !== null && <ErrorAlert message={error} onRetry={() => void refresh()} />}

          {sessions.length === 0 && !isLoading && error === null && (
            <p className="py-1 text-[10px] text-slate-600">No sessions yet</p>
          )}

          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              isActive={activeSessionId === session.id}
              onSelect={() => selectSession(session.id)}
            />
          ))}

          {flow.actions.length > 0 && (
            <>
              <div className="py-1">
                <span className="text-[10px] font-medium uppercase text-slate-500">Actions</span>
              </div>
              {flow.actions.map((action) => (
                <div key={action} className="px-2 py-0.5 text-xs text-slate-400">
                  {action}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Copies the instance's full id.
 *
 * The row truncates a long id to fit the navigator, and an operator addressing
 * a client at this instance needs the whole string exactly — retyping what a
 * truncation shows is how the wrong copy gets addressed.
 */
function CopyInstanceId({ flowId }: { flowId: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-5 w-5 p-0"
      title={`Copy instance ID: ${flowId}`}
      aria-label={`Copy instance ID ${flowId}`}
      onClick={() => {
        void navigator.clipboard?.writeText(flowId);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-400" />
      ) : (
        <Copy className="h-3 w-3 text-slate-500" />
      )}
    </Button>
  );
}
