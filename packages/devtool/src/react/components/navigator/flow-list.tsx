/**
 * The instance list — one row per registered flow instance, keyed and selected
 * by its exact id.
 *
 * Two copies of one kind are two rows here, and nothing about a row is derived
 * from its kind or its position in the list: they would tie, and a tie is how
 * one copy's sessions ended up under the other.
 */
import { Inbox } from "lucide-react";
import { useDevTool } from "../../context/devtool-context";
import { FlowItem } from "./flow-item";
import { EmptyState } from "../shared/empty-state";
import { ErrorAlert } from "../shared/error-alert";

export function FlowList({
  sessionRefreshKey,
  onRefreshActiveSession,
}: {
  sessionRefreshKey?: number;
  onRefreshActiveSession?: () => void;
}) {
  const {
    flows,
    flowsLoading: isLoading,
    flowsError: error,
    refreshFlows: refresh,
    activeFlowId,
    selectInstance,
  } = useDevTool();

  if (error) {
    return <ErrorAlert message={error} onRetry={refresh} className="mx-1" />;
  }

  if (isLoading && flows.length === 0) {
    return (
      <div className="space-y-2 px-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-slate-800/50" />
        ))}
      </div>
    );
  }

  if (flows.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-6 w-6" />}
        message="No flows registered. Start a flow-state server to see flows here."
      />
    );
  }

  return (
    <div className="space-y-0.5" role="list" aria-label="Flow instances">
      {flows.map((flow) => (
        <FlowItem
          key={flow.id}
          flow={flow}
          isActive={activeFlowId === flow.id}
          onSelect={() => selectInstance(activeFlowId === flow.id ? null : flow.id)}
          sessionRefreshKey={sessionRefreshKey}
          onRefreshActiveSession={onRefreshActiveSession}
        />
      ))}
    </div>
  );
}
