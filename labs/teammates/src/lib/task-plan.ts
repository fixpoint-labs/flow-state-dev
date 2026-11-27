/**
 * The harness plan a coding task recorded, through harness-manager's recorded
 * work view, polled while the task popup watches the run.
 */
import { CODER_FLOW, recordedWorkViewRef, type CodingBoardTask, type RecordedWork } from "@flow-state-dev/harness-manager/browser";
import { useView } from "@flow-state-dev/react";
import { useAppClient } from "../app/provider";

export function useTaskPlan(task: CodingBoardTask | undefined): RecordedWork["plan"] | undefined {
  const { client, pollIntervalMs } = useAppClient();
  const sessionId = task?.run?.sessionId;
  const requestId = task?.run?.requestId;
  const coding = task?.runFlow === CODER_FLOW && sessionId !== undefined && requestId !== undefined;
  return useView(recordedWorkViewRef(), { requestId: requestId ?? "" }, { client, pollIntervalMs, sessionId: sessionId ?? undefined, enabled: coding }).value
    ?.plan;
}