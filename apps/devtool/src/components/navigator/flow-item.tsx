import { ChevronDown, ChevronRight, Plus, RefreshCw } from "lucide-react";
import type { FlowListEntry } from "@flow-state-dev/client";
import { Button } from "@/components/ui/button";
import { useDevTool } from "@/context/devtool-context";
import { useSessions } from "@/hooks/use-sessions";
import { useActiveSession } from "@/hooks/use-active-session";
import { SessionRow } from "./session-row";
import { BlockTree } from "./block-tree";

type FlowItemProps = {
  flow: FlowListEntry;
  isActive: boolean;
  onSelect: () => void;
};

export function FlowItem({ flow, isActive, onSelect }: FlowItemProps) {
  const { setActiveSession } = useDevTool();
  const { sessions, isLoading, refresh, createSession } = useSessions(isActive ? flow.kind : null);
  const { activeSessionId, setActiveSessionId } = useActiveSession(isActive ? flow.kind : null);

  const handleCreateSession = async () => {
    const newId = await createSession();
    if (newId) {
      setActiveSessionId(newId);
      setActiveSession(newId);
    }
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setActiveSession(sessionId);
  };

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-800/60"
        onClick={onSelect}
      >
        {isActive ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        )}
        <span className="flex-1 truncate font-medium">{flow.kind}</span>
      </button>

      {isActive && (
        <div className="ml-3 border-l border-slate-800 pl-2">
          <div className="flex items-center gap-1 py-1">
            <span className="flex-1 text-[10px] font-medium uppercase text-slate-500">Sessions</span>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => refresh()} title="Refresh sessions">
              <RefreshCw className={`h-3 w-3 text-slate-500 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={handleCreateSession} title="New session">
              <Plus className="h-3 w-3 text-slate-500" />
            </Button>
          </div>

          {sessions.length === 0 && !isLoading && (
            <p className="py-1 text-[10px] text-slate-600">No sessions yet</p>
          )}

          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              isActive={activeSessionId === session.id}
              onSelect={() => handleSelectSession(session.id)}
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
