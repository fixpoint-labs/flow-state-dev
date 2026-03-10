import { Inbox } from "lucide-react";
import { useFlows } from "@/hooks/use-flows";
import { useDevTool } from "@/context/devtool-context";
import { FlowItem } from "./flow-item";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";

export function FlowList() {
  const { flows, isLoading, error, refresh } = useFlows();
  const { activeFlowKind, setActiveFlow } = useDevTool();

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
    <div className="space-y-0.5">
      {flows.map((flow) => (
        <FlowItem
          key={flow.kind}
          flow={flow}
          isActive={activeFlowKind === flow.kind}
          onSelect={() => setActiveFlow(activeFlowKind === flow.kind ? null : flow.kind)}
        />
      ))}
    </div>
  );
}
