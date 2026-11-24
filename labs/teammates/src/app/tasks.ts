/**
 * The tasks a conversation files, and each one's work, read only through the
 * packages: harness-manager's coding board view (`useTasks`, and `useTaskDetail`
 * for the open popup's one task, with its answer), a task's run session
 * (`useSessionFeed`), its run request's own stream for the call in flight
 * (`useRequestStream`), harness-manager's recorded work view for the plan, and
 * its direct reads for a run's files and pull requests. The board's actions and
 * your answers go through orchestration's Inbox client (`useTaskActions`).
 */
import { useEffect, useMemo, useState } from "react";
import { conversationLines, useRequestStream, useSessionFeed, useView } from "@flow-state-dev/react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { createInboxClient } from "@flow-state-dev/orchestration/inbox";
import {
  codingBoardViewRef,
  readRecordedWork,
  readSessionPullRequests,
  CODER_FLOW,
  recordedWorkViewRef,
  reviewDetail,
  type CodingBoardTask,
  type RecordedWork,
} from "@flow-state-dev/harness-manager/browser";
import { teammatesRenderers } from "../components/lines";
import { toolInFlight, type PlanRowNow } from "../components/flow-state/working-status";
import type { ReviewAnswer } from "../components/flow-state/review-hold";
import { inboxAnswerOf, rerunOverrides, taskStatus } from "../lib/task";
import { useAppClient } from "./provider";

/** The board a conversation files its tasks on: Workforce's `"tasks"`. */
const TASK_BOARD = "tasks";
/** The one item type a run request's own stream is read for: the tool call in flight. */
const TOOL_CALLS = { itemTypes: ["tool_output"] };

/** A conversation's tasks, oldest first, as the coding board view answers them; `stale` while its last read failed. */
export function useTasks(sessionId: string | undefined): { value: CodingBoardTask[] | undefined; stale: boolean } {
  const { client, pollIntervalMs } = useAppClient();
  const read = useView(codingBoardViewRef(), { sessionId: sessionId ?? "" }, { client, pollIntervalMs, enabled: sessionId !== undefined });
  return { value: sessionId === undefined ? undefined : read.value, stale: read.stale };
}

/**
 * The open popup's read: every task of the conversation, as {@link useTasks}
 * reads them, with the one `taskId` names carrying its answer (`detail`). Only
 * the popup calls it; a card reads {@link useTasks}.
 */
export function useTaskDetail(sessionId: string, taskId: string): { value: CodingBoardTask[] | undefined; stale: boolean } {
  const { client, pollIntervalMs } = useAppClient();
  const read = useView(codingBoardViewRef(), { sessionId, taskId }, { client, pollIntervalMs });
  return { value: read.value, stale: read.stale };
}

/**
 * A task's run, read only: its lines from its session's items, its latest
 * review stop (harness-manager's `reviewDetail`), and, while it runs, the call
 * in flight (the run request's own stream, which sends a call as it starts,
 * beside the feed, whose finished copy wins) and the plan its harness recorded.
 */
export function useTaskWork(task: CodingBoardTask | undefined) {
  const { client, pollIntervalMs } = useAppClient();
  const runSession = task?.run?.sessionId ?? null;
  const requestId = task?.run?.requestId ?? null;
  const running = task !== undefined && taskStatus(task) === "running" && requestId !== null;
  const feed = useSessionFeed(runSession, { client });
  const flowKind = task?.runFlow ?? undefined;
  // The plan view is the coding flow's: a run on any other flow is refused, so only a coder run reads it.
  const plan = useView(recordedWorkViewRef(), { requestId: requestId ?? "" }, { client, pollIntervalMs, sessionId: runSession ?? undefined, enabled: running && flowKind === CODER_FLOW }).value?.plan;
  const stream = useRequestStream({ client, flowKind, source: { requestId: requestId ?? "" }, filter: TOOL_CALLS, reconnect: true, flush: "immediate", enabled: running && flowKind !== undefined });
  return useMemo(() => {
    const fed = (feed?.items ?? []) as readonly OutputItem[];
    const stop = [...fed].reverse().find((item) => item.type === "suspension" && (item as { kind?: string }).kind === "review") as { data?: unknown } | undefined;
    const inFlight = running ? inFlightOf(stream.items as unknown as readonly OutputItem[], fed, requestId) : undefined;
    const steps = running ? plan?.rows.map(({ title, status }): PlanRowNow => ({ title, status })) : undefined;
    return {
      lines: runSession === null ? [] : conversationLines(fed, [], { renderers: teammatesRenderers }),
      replyStartedAt: running ? stream.startedAt : undefined,
      review: stop === undefined ? undefined : (reviewDetail(stop.data) ?? undefined),
      working: { ...(inFlight === undefined ? {} : { inFlight }), ...(steps === undefined ? {} : { plan: steps }) },
    };
  }, [feed?.items, runSession, running, requestId, stream.items, stream.startedAt, plan]);
}

/**
 * The call a run is in now: the request's own stream, which sends a call as it
 * starts, and the session feed, whose finished copy of a call wins. The feed's
 * own candidates are the run request's only: a reused session keeps the call a
 * crashed earlier request left half-done for good.
 */
function inFlightOf(streamed: readonly OutputItem[], fed: readonly OutputItem[], requestId: string | null) {
  const finished = new Set(fed.filter((item) => item.status !== "in_progress").map((item) => item.id));
  return toolInFlight(streamed.filter((item) => !finished.has(item.id))) ?? toolInFlight(fed.filter((item) => item.requestId === requestId));
}

/**
 * What a run's harness recorded touching, read by its session and request
 * through harness-manager's reader; read again when the task's status changes,
 * so an ended task shows all of it. `undefined` until read, or when the read
 * fails: the line then goes without files rather than say a wrong count.
 */
export function useRecordedFiles(task: CodingBoardTask): RecordedWork["files"] | undefined {
  const { client } = useAppClient();
  const sessionId = task.run?.sessionId;
  const requestId = task.run?.requestId;
  // Kept with the run it was read for: a retry's new run never shows the last attempt's files.
  const run = sessionId === undefined || requestId === undefined ? undefined : `${sessionId}\n${requestId}`;
  const [read, setRead] = useState<{ run: string; files: RecordedWork["files"] }>();
  useEffect(() => {
    if (run === undefined || sessionId === undefined || requestId === undefined) return;
    let live = true;
    readRecordedWork(client, { sessionId, requestId }).then((work) => live && setRead({ run, files: work.files }), () => {});
    return () => {
      live = false;
    };
  }, [client, run, sessionId, requestId, task.status]);
  return read !== undefined && read.run === run ? read.files : undefined;
}

/**
 * The links of the pull requests a task's run session recorded, by number:
 * what a task waiting on one links to. Read again when the numbers change;
 * empty when the session keeps none or can't be read.
 */
export function usePullRequestLinks(runSessionId: string | undefined, numbers: string): ReadonlyMap<number, string> {
  const { client } = useAppClient();
  const [links, setLinks] = useState<ReadonlyMap<number, string>>(new Map());
  useEffect(() => {
    if (runSessionId === undefined) return;
    let current = true;
    readSessionPullRequests(client, runSessionId).then(
      (opened) => current && setLinks(new Map(opened.map((pullRequest) => [pullRequest.number, pullRequest.url]))),
      (error) => console.warn(`teammates: the pull requests of run session ${runSessionId} couldn't be read`, error),
    );
    return () => {
      current = false;
    };
  }, [client, runSessionId, numbers]);
  return links;
}

/**
 * The board's actions on the tasks conversation `sessionId` filed, through the
 * Inbox client's `board(at)` on that conversation's `"tasks"` board: cancel,
 * steer, release, retry; `rerun`, which reads the task's brief whole (`get`)
 * and files it again on `worker`; and `answer`, on the hold the row you hand
 * it holds now. Each rejects with the board's own words on a refusal.
 */
export function useTaskActions(sessionId: string) {
  const { client } = useAppClient();
  return useMemo(() => {
    const inbox = createInboxClient(client);
    let flow: Promise<string> | undefined;
    const flowOf = () =>
      (flow ??= client.sessions.get(sessionId).then(
        (detail) => detail.flowId ?? detail.flowKind,
        (error: unknown) => {
          flow = undefined;
          throw error;
        },
      ));
    const board = async () => inbox.board({ flowId: await flowOf(), sessionId, board: TASK_BOARD });
    return {
      cancel: async (taskId: string) => (await board()).cancel(taskId),
      steer: async (taskId: string, message: string) => (await board()).steer(taskId, message),
      release: async (taskId: string) => (await board()).release(taskId),
      retry: async (taskId: string) => (await board()).retry(taskId),
      /** File `task` again as a new task on `worker`, its whole brief kept and a line naming the task it re-runs added. Resolves to the new task's id. */
      rerun: async (task: CodingBoardTask, worker: string) => {
        const actions = await board();
        const brief = await actions.get(task.id);
        return actions.refile(brief, rerunOverrides(task, brief.context, worker));
      },
      /** Answer what `task` waits on you for: a question's words, or a review's verdict. */
      answer: async (task: CodingBoardTask, answer: { text: string } | ReviewAnswer) => {
        const kind = "text" in answer ? "question" : "review";
        // No fresh board read: the server refuses a round the run moved past (409 already-resolved),
        // so it never lands on the newer one (popup-holds.test "refuses, out loud…").
        const hold = task.asks.find((h) => h.ask.kind === kind);
        if (hold === undefined) throw new Error(`This task isn't waiting on your ${kind === "question" ? "answer" : "review"} any more.`);
        await inbox.answerOne(hold, inboxAnswerOf(answer));
      },
    };
  }, [client, sessionId]);
}
