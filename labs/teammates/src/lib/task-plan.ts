/**
 * The harness plan a coding task recorded: polled through the recorded work
 * view while the task runs, then settled once when its status changes.
 */
import {
  CODER_FLOW,
  readRecordedWork,
  recordedWorkViewRef,
  type CodingBoardTask,
  type RecordedWork,
} from "@flow-state-dev/harness-manager/browser";
import { useEffect, useRef, useState } from "react";
import { useView } from "@flow-state-dev/react";
import { taskStatus } from "./task";
import { useAppClient } from "../app/provider";

export function useTaskPlan(task: CodingBoardTask | undefined): RecordedWork["plan"] | undefined {
  const { client, pollIntervalMs } = useAppClient();
  const sessionId = task?.run?.sessionId;
  const requestId = task?.run?.requestId;
  const running = task !== undefined && taskStatus(task) === "running";
  const coding = task?.runFlow === CODER_FLOW && sessionId !== undefined && requestId !== undefined;
  const live = useView(recordedWorkViewRef(), { requestId: requestId ?? "" }, {
    client,
    pollIntervalMs: running ? pollIntervalMs : null,
    sessionId: sessionId ?? undefined,
    enabled: coding,
  }).value?.plan;
  const run = coding ? `${sessionId}\n${requestId}` : undefined;
  const seen = useRef<{ run: string; plan: RecordedWork["plan"] } | undefined>(undefined);
  if (run !== undefined && live !== undefined) seen.current = { run, plan: live };
  const [settled, setSettled] = useState<{ run: string; plan: RecordedWork["plan"] }>();
  useEffect(() => {
    if (run === undefined || sessionId === undefined || requestId === undefined || running) return;
    let active = true;
    readRecordedWork(client, { sessionId, requestId }).then(
      (work) => active && setSettled({ run, plan: work.plan }),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [client, run, sessionId, requestId, running, task?.status]);
  if (!coding) return undefined;
  if (running) return live;
  if (settled !== undefined && settled.run === run && settled.plan !== null) return settled.plan;
  if (seen.current !== undefined && seen.current.run === run && seen.current.plan !== null) return seen.current.plan;
  if (settled !== undefined && settled.run === run) return settled.plan;
  return live;
}