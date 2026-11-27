// FIX-2774 D1, D2; one answer for the count and its list: FIX-1662 PLAN S3.
/**
 * The Inbox, its count, the Tasks board, the shift summary's needs-you
 * numbers and a task's asks, from one answer: workforce's `inbox` view,
 * built on the server from the pending asks and every board's rows. Every
 * screen that draws one of them reads it here, so a count and its list, and a
 * task's asks and its Inbox item, never disagree.
 *
 * The view is kept current by the server: a suspension written or answered
 * and a board row written re-run it, and nothing a streamed reply or a turn
 * elsewhere writes does. It is read again every {@link INBOX_POLL_MS} where
 * push can miss a change. An answer goes through orchestration's one answer
 * call; the suspension notice it publishes takes the item away, with no
 * read of the Lab after it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { ResumeAction } from "@flow-state-dev/core/types";
import { useView } from "@flow-state-dev/react";
import { createInboxClient, suspensionHoldId, type BoardActions, type InboxAnswer, type InboxHold, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { inboxViewRef, type InboxSuspensionDetail as InboxAsk, type InboxBoardTask, type InboxViewValue } from "@flow-state-dev/workforce/browser";
import { CODER_FLOW, runChangesViewRef } from "@flow-state-dev/harness-manager/browser";
import type { RunChangesPatch } from "../components/flow-state/run-changes";
import { isDone } from "./columns";
import { CONVERSATION_BOARD_COLLECTION } from "./boards";
import { useReportFeedState } from "./feed-health";
import { useLab } from "./lab-data";
import { describeFailure, type Failure, type Section } from "./failure";
import { sessionOfHold } from "./inbox-list";
import { useRetrySessionFeed, useSharedSessionFeed } from "./session-feeds";

export type { InboxAsk, InboxBoardTask, InboxViewValue };

/** An Inbox item, each suspension hold carrying its ask's detail. */
type InboxViewItem = InboxItem<InboxAsk>;
/** One hold of an Inbox item. */
type InboxViewHold = InboxHold<InboxAsk>;

/** How often the view is read again where push can miss a change. */
const INBOX_POLL_MS = 30_000;

/** The inbox view, as a screen reads it. */
type InboxRead = {
  /** The view's answer, or why it has none; `undefined` until the first read lands or fails. */
  section: Section<InboxViewValue> | undefined;
  /** `true` while the last read failed, though an earlier answer is still drawn. */
  stale: boolean;
  /** While `stale`, why the latest read failed: the server's reason and status, drawn beside the older answer. */
  failure: Failure | undefined;
  /** Read the view again now: Retry, R and *as of · refresh*. */
  refresh(): void;
  /** When the view's answer last landed here, epoch ms: what *as of* says. `undefined` before. */
  readAt: number | undefined;
};

/**
 * The user's inbox view. A failed read with an answer already drawn keeps
 * that answer, says it is `stale` and why (`failure`), and tells the page's
 * connection bar it has lapsed, so an old count never reads as current; with
 * no answer yet, the section is the failure. `enabled: false` reads nothing:
 * the shell reads it only once the Lab let Shift Manager in.
 */
export function useInbox(enabled = true): InboxRead {
  const { client } = useLab();
  const { value, stale, failure, refresh } = useView(inboxViewRef, {}, { client, pollIntervalMs: INBOX_POLL_MS, enabled });
  const section = useMemo<Section<InboxViewValue> | undefined>(
    () => (value !== undefined ? { ok: true, value } : failure !== undefined ? { ok: false, failure: failure as Failure } : undefined),
    [value, failure],
  );
  const lapsed = value !== undefined && stale && failure !== undefined;
  useReportFeedState(enabled && value !== undefined ? (lapsed ? "lapsed" : "live") : undefined);
  const [readAt, setReadAt] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (value !== undefined) setReadAt(Date.now());
  }, [value]);
  return { section, stale, failure: lapsed ? (failure as Failure) : undefined, refresh, readAt };
}

/**
 * Every task, finished ones too, for Jump to while it is open: `undefined`
 * until that read lands, or while `enabled` is false (it reads nothing then).
 */
export function useInboxTasks(enabled: boolean): readonly InboxBoardTask[] | undefined {
  const { client } = useLab();
  const { value } = useView(inboxViewRef, { done: true }, { client, enabled });
  return value?.tasks;
}

// BR-15.
/** The rows Tasks shows: every board's, excluding done ones. */
export function openBoardTasks(value: InboxViewValue): InboxBoardTask[] {
  return value.tasks.filter((task) => !isDone(task.status));
}

/**
 * The Inbox item that shows hold `holdId`: a task's item when its task holds
 * it, else the ask's own. The hold's id when the view doesn't list it, so a
 * link still opens the Inbox.
 */
export function itemIdHolding(items: readonly InboxViewItem[], holdId: string): string {
  return items.find((item) => item.holds.some((hold) => hold.id === holdId))?.id ?? holdId;
}

/** A task's Inbox item, by its board and id; `undefined` when nothing of it waits on the user. */
function itemOfTask(items: readonly InboxViewItem[], task: Pick<InboxBoardTask, "boardRef" | "id"> | undefined): InboxViewItem | undefined {
  if (task === undefined) return undefined;
  return items.find((item) => item.task?.board === task.boardRef && item.task.taskId === task.id);
}

// FIX-2131.
/**
 * Whether a task holds on a question or confirm for you: its Inbox item has a
 * hold the board keeps on the row. A task waiting on its run's stop for you
 * shows that stop as an ask instead ({@link taskAsks}).
 */
export function holdsOnYou(items: readonly InboxViewItem[], task: Pick<InboxBoardTask, "boardRef" | "id"> | undefined): boolean {
  return itemOfTask(items, task)?.holds.some((hold) => hold.source.kind === "task") ?? false;
}

// BR-17; D2.
/** The stops a task's run waits on you with: its Inbox item's suspension holds, oldest first. */
export function taskAsks(items: readonly InboxViewItem[], task: Pick<InboxBoardTask, "boardRef" | "id"> | undefined): InboxViewHold[] {
  return itemOfTask(items, task)?.holds.filter((hold) => hold.source.kind === "suspension") ?? [];
}

/** Every stop that waits on you, oldest first: each Inbox item's suspension holds. */
export function everyAsk(items: readonly InboxViewItem[]): InboxViewHold[] {
  return items.flatMap((item) => item.holds.filter((hold) => hold.source.kind === "suspension")).sort((a, b) => a.openedAt - b.openedAt);
}

/** The word an ask is drawn with: an input is a question. */
export function askWord(hold: InboxViewHold): "approval" | "review" | "question" | "confirm" {
  const asked = hold.ask.kind;
  return asked === "approval" || asked === "review" || asked === "confirm" ? asked : "question";
}


/**
 * The suspension a stop's card draws: from the ask's detail, or, when the view
 * found none for a stop the task's entry records, from what the entry says of it.
 * A review's data, which the detail never carries, is `data` when given.
 */
export function suspensionOfHold(hold: InboxViewHold, data?: Record<string, unknown>): SuspensionItem {
  const ask = hold.detail;
  const variant = hold.ask.kind === "approval" || hold.ask.kind === "review" ? hold.ask.kind : "input";
  const requestId = hold.source.kind === "suspension" ? hold.source.requestId : "";
  const suspensionId = hold.source.kind === "suspension" ? hold.source.suspensionId : hold.id;
  return {
    type: "suspension",
    id: suspensionId,
    suspensionId,
    requestId,
    status: "completed",
    suspensionStatus: "pending",
    reason: variant === "approval" ? "user_approval" : "user_input",
    kind: variant,
    message: ask?.message ?? hold.ask.prompt,
    ...((ask?.title ?? hold.ask.title) !== undefined ? { title: ask?.title ?? hold.ask.title } : {}),
    allow: ask?.allow !== undefined ? [...ask.allow] : variant === "approval" ? ["approve", "reject"] : ["submit"],
    ...(ask?.resumeSchema !== undefined ? { resumeSchema: ask.resumeSchema } : {}),
    ...(ask?.render !== undefined ? { render: ask.render } : {}),
    ...(hold.due !== undefined ? { expiresAt: hold.due } : {}),
    ...(data !== undefined ? { data } : {}),
  } as unknown as SuspensionItem;
}

/** The answer a card's resolution is, in the shape a stop of this kind takes. */
export function answerOfResolution(hold: InboxViewHold, action: ResumeAction, data: unknown): InboxAnswer {
  if (hold.ask.kind === "approval") return { approved: action === "approve", ...(data === undefined ? {} : { data }) };
  return action === "skip" ? { skipped: true } : { value: data };
}

/**
 * Answer one hold through orchestration's one answer call. No read follows:
 * the server's notice takes the item away, and a conversation on screen hears
 * its session's resume on its own live feed.
 */
export function useInboxAnswer(): (hold: InboxViewHold | InboxHold<unknown>, answer: InboxAnswer) => Promise<void> {
  const { client } = useLab();
  const inbox = useMemo(() => createInboxClient(client), [client]);
  return useCallback((hold, answer) => inbox.answerOne(hold, answer), [inbox]);
}

// FIX-2381.
/**
 * The task actions of a conversation's board: cancel, steer, release, retry
 * and re-file, orchestration's `inbox.board(...)` bound to the conversation's
 * session and the flow that owns it, as the signed-in user. Each rejects with
 * the board's refusal. `undefined` for a conversation whose session names no
 * owning flow (or isn't listed yet): it has no board to act on.
 */
export function useBoardActions(conversation: { id: string; flowId: string } | undefined): BoardActions | undefined {
  const { client } = useLab();
  const id = conversation?.id;
  const flowId = conversation?.flowId;
  return useMemo(
    () => (id === undefined || flowId === undefined ? undefined : createInboxClient(client).board({ flowId, sessionId: id, board: CONVERSATION_BOARD_COLLECTION })),
    [client, id, flowId],
  );
}

/** Where a review's data stands: no read needed, being read, read, or the read failed. */
export type ReviewData =
  | { state: "none" }
  | { state: "reading" }
  | { state: "read"; data: Record<string, unknown> | undefined }
  | { state: "failed"; failure: Failure; retry(): void };

/**
 * A review's data (what the run committed, the landing choices offered and the
 * judge's verdict), which the view's projection never carries: read from the
 * ask's session feed, as the Inbox's detail reads its session. `none` for a
 * stop that is no review, and for a run with no conversation, which has no
 * feed to read. A review is answered only once its data is `read`: answered
 * without it, the card offers a plain Accept that lands nothing.
 */
export function useReviewData(hold: InboxViewHold): ReviewData {
  const sessionId = sessionOfHold(hold);
  const review = hold.ask.kind === "review" && sessionId !== null;
  // The page's one feed for the ask's session; a feed whose read gave up is opened anew on Retry.
  const feed = useSharedSessionFeed(review ? sessionId : null);
  const retry = useRetrySessionFeed(review ? sessionId : null);
  const items = feed?.items;
  const error = feed?.error ?? null;
  return useMemo((): ReviewData => {
    if (!review) return { state: "none" };
    if (items !== undefined) {
      const found = items.find((item): item is SuspensionItem => item.type === "suspension" && suspensionHoldId(item.requestId, (item as SuspensionItem).suspensionId) === hold.id);
      return { state: "read", data: found?.data };
    }
    if (error !== null) return { state: "failed", failure: describeFailure(error), retry };
    return { state: "reading" };
  }, [review, items, error, hold.id, retry]);
}

// FIX-2796.
/**
 * Reads one file's patch for a coding run's review, in place: harness-manager's
 * `changes` view on the coding worker flow, called in the ask's session, so the
 * card's file list opens into each file's diff with no pull request needed.
 * `undefined` for a stop the coding worker flow didn't raise (no such view to
 * call) and for a run with no session: its files list their lines and don't open.
 */
export function usePatchReader(hold: InboxViewHold): ((path: string) => Promise<RunChangesPatch>) | undefined {
  const { client } = useLab();
  const sessionId = sessionOfHold(hold);
  const coding = hold.ask.kind === "review" && hold.detail?.flowKind === CODER_FLOW;
  return useMemo(() => {
    if (!coding || sessionId === null) return undefined;
    return async (path: string) => {
      const { patch } = (await client.view(runChangesViewRef(), { path }, { sessionId })).value;
      if (patch === null) throw new Error("the run answered no patch for this file");
      return patch;
    };
  }, [client, coding, sessionId]);
}
