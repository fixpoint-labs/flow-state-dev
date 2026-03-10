import { useDevTool } from "@/context/devtool-context";

export function useFlows() {
  const { flows, flowsLoading, flowsError, refreshFlows } = useDevTool();
  return { flows, isLoading: flowsLoading, error: flowsError, refresh: refreshFlows };
}
