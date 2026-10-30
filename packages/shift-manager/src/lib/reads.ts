/**
 * The one module every Shift Manager surface reads the Lab through.
 *
 * A refresh makes each read once and hands back one snapshot. Counts, badges
 * and screens all draw from that snapshot, so the sidebar's Inbox count and
 * the Inbox list can never disagree, and a Lab with dozens of workers costs one
 * listing and one ask read per worker session, not one per badge.
 *
 * What a refresh reads, in order:
 *
 * 1. **The user's sessions**, dispatch runs included. A worker a dispatch
 *    woke runs in a dispatch-run session, which the default listing leaves
 *    out, so without `include: "dispatch-runs"` that worker's ask would be
 *    invisible. This is also Shift Manager's first read: when the Lab refuses it
 *    for want of a verified organization, the snapshot is only that refusal
 *    and nothing else is read (BR-3).
 * 2. **The organization**, off a listed session. The listing only ever holds
 *    sessions in the organization the Lab resolved for the user, and a
 *    session records it. A user who holds no session of their own on the
 *    roster flow yet has one opened on it first (`withReaderSessions`), and the Lab stamps it with the organization it
 *    resolves for them, so a user on a first visit is read like any other.
 *    A Lab that still lists the user no session (it serves no roster) names
 *    no organization, and gets the refusal too: Shift Manager never draws a
 *    Lab under an unknown one (ER-4).
 * 3. **The inventory**: the organization's worker collection, found by its
 *    published key pattern in the manifest of a listed session whose flow
 *    declares it (the roster flow does). Nothing about the tree is written in
 *    Shift Manager; this is where every worker and team name comes from.
 * 4. **Every conversation's board**: the tasks a
 *    conversation filed sit in one collection at the user's own scope,
 *    each under its conversation's partition, so one read through any
 *    session whose flow declares it answers every board of theirs, grouped
 *    here by the conversation that holds it (`<sessionId>.tasks`).
 * 5. **Pending asks**: for each listed session a worker owns, the suspension
 *    items only, reduced by `react`'s `deriveSuspensions` to the ones still
 *    pending. Not the transcript. A worker is one the inventory registers, or
 *    one of the user's own workers: those are on their roster, never in the
 *    inventory, so the roster is read first, through Workforce's `roster()`,
 *    which answers for the caller only.
 * 6. **Declared documents** a browser may read, from each listed flow's
 *    manifest, for Jump to (BR-10).
 * 7. **The projects the user reads**: every row of the organization's
 *    `projects` collection and of their own private one, found by the
 *    published key pattern and scope on a flow the user holds a session of
 *    (the roster flow declares both). PROJECTS lists them. A project's
 *    workstream entries are never read here: a project's view reads them, by
 *    its one prefix, when it opens (`projects.ts`).
 *
 * Every read after the first fails on its own: a failed section carries its
 * failure and the rest of the snapshot is whole (BR-11). Nothing retries by
 * itself, and nothing is filled in from a guess.
 *
 * Manifests are static per flow, so they are cached across refreshes by
 * flow, never re-read per screen.
 *
 * The one answer path, {@link LabReader.resume}, is here too, so Inbox and
 * Shift Coordinator resolve an ask the same way: through the flow the ask's
 * session records as its owner (`flowId`), never the board's.
 */
import { ClientHttpError, readEveryCollectionPage, type ResourceManifest, type SessionSummary } from "@flow-state-dev/client";
import type { OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import { isUserSuspension, suspendForUserKindOf, type ResumeAction } from "@flow-state-dev/core/types";
import { deriveSuspensions, suspensionShape } from "@flow-state-dev/react";
import { ROSTER_FLOW, sessionIdOfFiling, WORKER_ID_STATE_KEY, WORKSTREAM_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import type { Client } from "@flow-state-dev/client";
import { createInboxClient, inboxItems, taskHoldSchema, type InboxAnswer, type InboxHold, type InboxItem, type InboxRow, type TaskHold } from "@flow-state-dev/orchestration/inbox";

/** Why a read did not load. */
export type Failure = { message: string; httpStatus?: number };

/**
 * The worker a session runs, as its state names it (`workerId`), or `null`
 * when it names none.
 */
export function workerOf(session: SessionSummary): string | null {
  return text(field((session as { state?: unknown }).state, WORKER_ID_STATE_KEY));
}

/**
 * The workstream a session leads, as its readonly `workstreamId` names it
 * (`<visibility>/<project>/<workstream>`), or `null` for a session outside
 * any workstream.
 */
export function workstreamOf(session: SessionSummary): string | null {
  return text(field((session as { state?: unknown }).state, WORKSTREAM_STATE_KEY));
}

/** One section's outcome: its value, or why it has none. */
export type Section<T> = { ok: true; value: T } | { ok: false; failure: Failure };

/** A worker, as the worker inventory registers it: one worker. */
export type Worker = {
  /**
   * The worker's id: `<team>.<name>`, or a bare name for an org worker. Boards
   * name the worker by it, and its sessions carry it as their `workerId`.
   */
  id: string;
  /** The worker flow the worker runs on, which is also that flow's copy id; `null` on a row that has none. */
  kind: string | null;
  /**
   * The action that takes a user's message into this worker's sessions, as
   * the hire published it; `null` when its worker flow takes none, or on a row
   * written before doors were published.
   */
  door: string | null;
  /**
   * Whether the worker keeps standing rules: its worker flow declares the
   * rules action, as the hire published it. `false` on a row written before
   * the field.
   */
  rules: boolean;
  /** The id of the team it sits under, or {@link GENERAL_TEAM} for an org worker (see {@link toWorker}). */
  team: string;
  /** Its team's display name: the team's own, "General" for {@link GENERAL_TEAM}, else the team id. */
  teamName: string;
  /** Its id without the team: what a board may name it by. */
  name: string;
  /** What a user reads it by: its display name, or its id when it has none. */
  displayName: string;
};

/** Where a project lives: the organization's, or the user's own. */
export type ProjectVisibility = "shared" | "private";

/**
 * A project: a row of the organization's `projects` collection (shared), or of
 * the user's own (private). It names no team: its workstreams are its
 * entries, read on its screen. Its address is its
 * visibility and its id: a private project and a shared one can share an id.
 */
export type Project = {
  /** The row id; with the visibility, the project's address. */
  id: string;
  /** Where the row lives. */
  visibility: ProjectVisibility;
  title: string;
  /** What the project is for; its Brief tab. `null` when none was given. */
  brief: string | null;
  status: string;
  ownerUserId: string;
  /** On a shared project, who may open workstreams in it. */
  members: string[];
  /**
   * The git remote the project's code lives in, or `null` when it has none
   * (its coding work runs on its files). A row written before the field
   * existed reads as none.
   */
  repository: string | null;
};

/** The projects the user reads: the organization's, and their own private ones. */
export type Projects = {
  /** Every row: the shared ones in the collection's order, then the private ones. */
  rows: Project[];
};

/**
 * The run working a task, or the run that last worked it: the session a
 * dispatched attempt runs in, that attempt's request there, and the attempt
 * number. The board's claim gate writes it from inside the run; the next claim
 * clears it. It carries no flow: the run's flow is the one its session records
 * as its owner.
 */
export type RunLink = { sessionId: string; requestId: string; attempt: number };

/** One row on a conversation's board, with the fields a board publishes to a browser. */
export type BoardRow = {
  /** The board's ref: `<sessionId>.tasks`, the conversation that holds it and the collection. */
  boardRef: string;
  /** The session id of the conversation that holds the board. */
  ownerSessionId: string;
  id: string;
  title: string;
  /** The row's goal, as filed. */
  goal: string | null;
  /** The status as stored (see `columns.ts` for how it is read). */
  status: string;
  assignee: string | null;
  priority: string | null;
  labels: string[];
  /** The ids of the rows on the same board this one waits on. */
  deps: string[];
  /**
   * The run the board's gate linked to this row, or `null`: never claimed,
   * claimed but not yet started, or stored before the link existed.
   */
  run: RunLink | null;
  error: string | null;
  /**
   * What holds the row (FIX-2133): its questions and confirms, and its run's
   * stop for the user. Empty when nothing does. The Inbox lists the task's
   * item from the open ones.
   */
  holds: TaskHold[];
  /** Its steers as the Inbox reads them: which question each answers. A question is open while none does. */
  steers: Array<{ id: string; answers?: string }>;
  createdAt: number | null;
  updatedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
};

/** A conversation's board and every row on it. */
export type ConversationBoards = { refs: string[]; rows: BoardRow[] };

/** A pending approval, review or question, and the session that holds it. */
export type Ask = {
  /** The worker session the ask waits in. */
  sessionId: string;
  /** The worker that asked, when the session names its owner. */
  workerId: string | null;
  /**
   * The worker's flow copy that owns the session, which is what the answer goes
   * through. `null` on a session written before instance ownership: its ask
   * is shown, and its answer is unavailable.
   */
  flowId: string | null;
  /** The session that started this run, for a dispatch run. */
  parentSessionId: string | null;
  kind: "approval" | "review" | "question";
  item: SuspensionItem;
  /** When the ask was raised, epoch ms. */
  since: number;
  /**
   * Why this ask can't be answered from Shift Manager, or `null` when it can.
   * Shown on the card; the card offers no answer when it is set. Every ask
   * answers through the Lab's answer route (FIX-2129), whatever started its
   * run, a task's included: only one whose session names no flow can't.
   */
  unanswerable: string | null;
};

/**
 * Why a Lab that lists the user no session, even after one was asked for on
 * the reader flows, is refused: nothing it serves says which organization they are in.
 */
function noOrganization(userId: string, why = "it holds no session of theirs and serves no roster flow to open one on"): string {
  return `The Lab names no organization for ${userId}: ${why}, and a session is where the Lab records the organization it puts them in. Shift Manager's README lists what a Lab opens at boot.`;
}

/** What an ask's card says when its session names no owning flow. */
export const UNOWNED_SESSION_UNANSWERABLE =
  "This ask can't be answered from Shift Manager: its session was written before sessions recorded their owning flow, so there is no flow to answer it through.";

/**
 * A declared document the Lab serves to a browser (its frontmatter opts in to
 * content reads), and a session whose flow serves it, to read it through.
 */
export type DeclaredResource = { ref: string; sessionId: string };

/** The organization's workers, as the inventory registers them. */
export type Inventory = {
  /** Every worker the inventory registers. */
  workers: Worker[];
};

/** Everything one refresh read. */
export type LabSnapshot =
  /** No organization to open the Lab under: the Lab said no, or named none. */
  | { refused: Failure; unreachable?: undefined }
  /** The first read failed for another reason (a 5xx, the network). Retrying may help. */
  | { unreachable: Failure; refused?: undefined }
  | {
      refused?: undefined;
      unreachable?: undefined;
      /** When this refresh finished, epoch ms. */
      readAt: number;
      /** The user's listed sessions, dispatch runs included. */
      sessions: SessionSummary[];
      /** The organization the Lab bound this user's sessions to. */
      orgId: string;
      inventory: Section<Inventory>;
      /**
       * The organization's projects. A Lab whose flows declare no projects
       * collection has none, which is not a failure.
       */
      projects: Section<Projects>;
      /** Per board holder: the id of a conversation that keeps a board. */
      boards: Record<string, Section<ConversationBoards>>;
      /** The pending asks in worker sessions: the Inbox's suspension arm, and what a task's screen shows inline. */
      asks: Section<Ask[]>;
      /**
       * Everything waiting on the user, as one list of orchestration's one
       * item type (`@flow-state-dev/orchestration/inbox`): an item per task
       * row that holds the user, and one per ask no row claims. Inbox, its
       * counts and every "needs you" total read this, and nothing else.
       */
      inbox: Section<InboxItem<Ask>[]>;
      /** The declared documents Jump to finds and opens read-only (BR-10). */
      resources: Section<DeclaredResource[]>;
    };

/** The organization's worker inventory, by its published key pattern. */
const WORKER_INVENTORY_PATTERN = "inventory/workers/*";

/**
 * The flow a user's own session for reading the worker inventory, their
 * projects and the workstream entries is opened on, when they hold none:
 * workforce's roster flow, which declares the workers, the projects at both
 * scopes and the entries.
 */
export const PROJECT_READER_FLOW = ROSTER_FLOW;

/**
 * The projects, by their published key pattern: one pattern, at the
 * organization's scope for the shared ones and the user's for their own.
 */
const PROJECT_PATTERN = "projects/*";

/** Rows per collection page: the collection route's maximum. */
const PAGE_SIZE = 200;
/** A guard against a server that pages suspension items forever; collection reads use the client's shared ceiling. */
const MAX_PAGES = 1000;
/** Suspension items per session-state page. */
const ASK_PAGE_SIZE = 200;
/** How many worker sessions are read at once. */
const ASK_READ_BATCH = 6;

/**
 * What the Lab answers a session open on a flow it doesn't serve, for the
 * roster flow: the engine's unknown-flow message. Matched exactly, so any
 * other 404 (the roster session's own reads) is a failure, not "no roster".
 */
const NO_ROSTER_FLOW = `Unknown flow "${ROSTER_FLOW}"`;

/** What a user's ask asks for: an approval, a review, or a question (an input). */
function askTypeOf(item: SuspensionItem): Ask["kind"] {
  const asked = suspendForUserKindOf(item) ?? (suspensionShape(item) === "approval" ? "approval" : "input");
  return asked === "input" ? "question" : asked;
}

/** One still-pending suspension, as `deriveSuspensions` reduces it. */
export type PendingSuspension = ReturnType<typeof deriveSuspensions>["pending"][number];

/**
 * The suspensions still pending in one session: every page of its suspension
 * and resume items, reduced by `react`'s `deriveSuspensions`. Inbox lists its
 * asks from this read.
 */
export async function readPendingSuspensions(client: Client, sessionId: string): Promise<PendingSuspension[]> {
  const items: OutputItem[] = [];
  for (let offset = 0, page = 0; page < MAX_PAGES; page += 1) {
    const state = await client.sessions.state(sessionId, {
      includeItems: true,
      itemTypes: ["suspension", "suspension_resume"],
      offset,
      limit: ASK_PAGE_SIZE,
    });
    items.push(...(state.items ?? []));
    if (state.pagination?.hasMore !== true) break;
    offset = state.pagination.nextOffset ?? offset + ASK_PAGE_SIZE;
  }
  return deriveSuspensions(items).pending;
}

/** A failure, in the server's own words when it sent any. */
export function describeFailure(error: unknown): Failure {
  if (error instanceof ClientHttpError) {
    const body = error.body as { error?: unknown; message?: unknown } | undefined;
    const said = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : undefined;
    return { httpStatus: error.status, message: said ?? error.message };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

function field(row: unknown, key: string): unknown {
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>)[key] : undefined;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function time(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * The id of the group an org worker sits in: a worker whose address has no
 * team, such as a Shift Coordinator or a researcher. A user reads it as
 * {@link GENERAL_TEAM_NAME}. The underscore keeps it outside Workforce's team
 * ids (lowercase letters, digits and hyphens), so a team folder named
 * `general` stays its own team.
 */
export const GENERAL_TEAM = "_general";

/** {@link GENERAL_TEAM}'s display name. */
export const GENERAL_TEAM_NAME = "General";

/**
 * A worker's team and names, from its id and the display names its row
 * carries (each `null` when unset):
 *
 * - `<team>.<name>` sits under its team: a team id carries no dot, so the team
 *   is everything before the first one;
 * - an id with no dot is an org worker, and sits in {@link GENERAL_TEAM}.
 */
export function workerNames(
  id: string,
  displayName: string | null,
  teamName: string | null,
): Pick<Worker, "team" | "teamName" | "name" | "displayName"> {
  const dot = id.indexOf(".");
  const team = dot > 0 ? id.slice(0, dot) : GENERAL_TEAM;
  return {
    team,
    teamName: dot > 0 ? (teamName ?? team) : GENERAL_TEAM_NAME,
    name: dot > 0 ? id.slice(dot + 1) : id,
    displayName: displayName ?? id,
  };
}

/** A worker inventory row, grouped and named by {@link workerNames}. */
export function toWorker(row: unknown): Worker | undefined {
  const id = text(field(row, "id"));
  if (id === null) return undefined;
  return {
    id,
    kind: text(field(row, "kind")),
    door: text(field(row, "door")),
    rules: field(row, "rules") === true,
    ...workerNames(id, text(field(row, "name")), text(field(row, "teamName"))),
  };
}

/**
 * A project row. A row missing its id, title or owner is not a project anyone
 * can address or own, and is left out; every other field reads as empty when
 * absent, so a row an earlier version wrote still reads (BP-030).
 */
export function toProject(row: unknown, visibility: ProjectVisibility = "shared"): Project | undefined {
  const id = text(field(row, "id"));
  const title = text(field(row, "title"));
  const ownerUserId = text(field(row, "ownerUserId"));
  if (id === null || title === null || ownerUserId === null) return undefined;
  return {
    id,
    visibility,
    title,
    // An empty brief is still the brief the row was given; only a missing or non-string one is none.
    brief: typeof field(row, "brief") === "string" ? (field(row, "brief") as string) : null,
    status: text(field(row, "status")) ?? "active",
    ownerUserId,
    members: strings(field(row, "members")),
    repository: text(field(row, "repository")),
  };
}

/**
 * A row's run link. Anything short of all three values reads as no link, so a
 * row stored before the link existed, or a malformed one, is *no run*, never a
 * guess (BP-030).
 */
function toRunLink(value: unknown): RunLink | null {
  const sessionId = text(field(value, "sessionId"));
  const requestId = text(field(value, "requestId"));
  const attempt = field(value, "attempt");
  if (sessionId === null || requestId === null || typeof attempt !== "number") return null;
  return { sessionId, requestId, attempt };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The holds a row publishes (FIX-2133), each read against the hold's own
 * shape: one that doesn't parse is none, never a guess.
 */
function toHolds(value: unknown): TaskHold[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((hold) => {
    const parsed = taskHoldSchema.safeParse(hold);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A row's steers as the Inbox reads them: each one's id, and the question it answers when it answers one. */
function toSteerAnswers(value: unknown): Array<{ id: string; answers?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((steer) => {
    const id = text(field(steer, "id"));
    const answers = text(field(steer, "answers"));
    return id === null ? [] : [{ id, ...(answers !== null ? { answers } : {}) }];
  });
}

/**
 * A board row, from what the board publishes.
 *
 * `title` is never absent: a row filed with none reads its goal there. The
 * Brief's `distinctTitle` (`lib/tasks.ts`) is written against that, and shows
 * a title only when it differs from `goal`.
 */
export function toBoardRow(boardRef: string, ownerSessionId: string, topic: string, data: unknown): BoardRow {
  return {
    boardRef,
    ownerSessionId,
    id: text(field(data, "id")) ?? topic,
    title: text(field(data, "title")) ?? text(field(data, "goal")) ?? topic,
    goal: text(field(data, "goal")),
    status: text(field(data, "status")) ?? "pending",
    assignee: text(field(data, "assignee")),
    priority: field(data, "priority") == null ? null : String(field(data, "priority")),
    labels: strings(field(data, "labels")),
    deps: strings(field(data, "deps")),
    run: toRunLink(field(data, "run")),
    error: field(data, "error") == null ? null : String(field(data, "error")),
    holds: toHolds(field(data, "holds")),
    steers: toSteerAnswers(field(data, "steers")),
    createdAt: time(field(data, "createdAt")),
    updatedAt: time(field(data, "updatedAt")),
    startedAt: time(field(data, "startedAt")),
    completedAt: time(field(data, "completedAt")),
  };
}

/**
 * The collection every conversation's board keeps its rows in: Workforce's
 * conversation ledger (`CONVERSATION_LEDGER_ID`), which its browser entry
 * doesn't export. `static.test.ts` pins the two together.
 */
export const CONVERSATION_BOARD_COLLECTION = "tasks";

/**
 * A conversation board's ref: `<sessionId>.tasks`, so a task route and a row
 * name their board one way.
 */
export function conversationBoardRef(sessionId: string): string {
  return `${sessionId}.${CONVERSATION_BOARD_COLLECTION}`;
}

/**
 * The collection a board's tasks are stamped with on their runs' items (the
 * `collectionId` of each `task-change`): for a conversation's board, the one
 * collection every conversation shares; any other ref names its own.
 */
export function collectionOfBoard(boardRef: string): string {
  return boardRef.endsWith(`.${CONVERSATION_BOARD_COLLECTION}`) ? CONVERSATION_BOARD_COLLECTION : boardRef;
}

/**
 * The conversation a conversation-ledger row belongs to: its topic is
 * `<partition>/<taskId>`, the partition the conversation's `filingSessionId`
 * percent-encoded into one segment, whose session id is everything before its
 * last `~`. Server-written, so this reads nothing a caller chose.
 */
export function conversationOfTopic(topic: string): string {
  return sessionIdOfFiling(decodeURIComponent(topic.split("/")[0] ?? ""));
}

/**
 * The Inbox section: orchestration's list over every board row and the asks
 * the worker sessions hold, a task run's ask listing from its row alone. A
 * list that can't hold one of them is a failure, never a shorter list: a
 * task held on a board that didn't load would be missing from it.
 *
 * `sessions` names the flow that owns each run's session, where a task's
 * answer goes.
 */
export function inboxSection(
  asks: Section<Ask[]>,
  boards: Record<string, Section<ConversationBoards>>,
  sessions: readonly Pick<SessionSummary, "id" | "flowId">[],
): Section<InboxItem<Ask>[]> {
  if (!asks.ok) return asks;
  const rows: BoardRow[] = [];
  for (const board of Object.values(boards)) {
    if (!board.ok) return { ok: false, failure: { ...board.failure, message: `Inbox lists what each task waits on from its board, and a board did not load. ${board.failure.message}` } };
    rows.push(...board.value.rows);
  }
  const flows = new Map(sessions.map((session) => [session.id, session.flowId ?? null]));
  return {
    ok: true,
    value: inboxItems<Ask>({
      rows: rows.map((row) => ({ ...row, board: row.boardRef, holder: boardOwnerOf(row) })),
      suspensions: asks.value.map((ask) => ({
        sessionId: ask.sessionId,
        flowId: ask.flowId,
        requestId: ask.item.requestId,
        suspensionId: ask.item.suspensionId,
        kind: suspendForUserKindOf(ask.item) ?? "input",
        prompt: ask.item.message,
        ...(ask.item.title ? { title: ask.item.title } : {}),
        since: ask.since,
        detail: ask,
      })),
      flowOf: (sessionId) => flows.get(sessionId),
    }),
  };
}

/**
 * Where a row's questions are answered (FIX-2133): the board's `updateTask`
 * action on the conversation that holds it, as the signed-in user. A board
 * that isn't a conversation's has no action Shift Manager names: `null`,
 * and its questions read as unanswerable here.
 */
function boardOwnerOf(row: BoardRow): InboxRow["holder"] {
  return row.boardRef === conversationBoardRef(row.ownerSessionId) ? { sessionId: row.ownerSessionId, action: UPDATE_TASK_ACTION } : null;
}

/**
 * The action a conversation answers a task's question through: the task
 * tools' `updateTask`, named for the conversation board's id (`tasks`) by the
 * task tools' action rule.
 */
export const UPDATE_TASK_ACTION = "updateTask_tasks";

/** Run `task` over `inputs`, `size` at a time, keeping order. */
async function inBatches<T, R>(inputs: readonly T[], size: number, task: (input: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < inputs.length; i += size) {
    out.push(...(await Promise.all(inputs.slice(i, i + size).map(task))));
  }
  return out;
}

/** Reads one Lab. Holds only the per-flow manifest cache between refreshes. */
export type LabReader = {
  /** One refresh: every read once. */
  read(): Promise<LabSnapshot>;
  /** Re-read one conversation's board, for a screen waiting on a row to move. */
  readBoard(sessionId: string): Promise<BoardRow[]>;
  /**
   * Answer an ask through its session's owning flow. Rejects when the session
   * names no owner, or when the Lab refuses the answer.
   */
  resume(ask: Ask, answer: { action: ResumeAction; data?: unknown }): Promise<void>;
  /**
   * Answer one of an Inbox item's holds through orchestration's one answer
   * call, routed by its source: a task's question or confirm through its
   * board's `updateTask`, as the user (FIX-2133). Rejects with the board's
   * refusal.
   */
  answerOne(hold: InboxHold<unknown>, answer: InboxAnswer): Promise<void>;
};

/**
 * The id of `userId`'s own reading session on `flow`: one per user per flow,
 * so two first visits at once (two tabs) open the same session rather than two.
 */
export function readerSessionId(userId: string, flow: string): string {
  return `${flow}-own-${userId}`;
}

/**
 * Reading-session opens in flight, per client and flow, so reads that overlap
 * on one page (StrictMode replaying the boot) share one open rather than racing it.
 */
const openingReaders = new WeakMap<Client, Map<string, Promise<void>>>();

/** Build the reader for one connection. */
export function createLabReader(client: Client): LabReader {
  const manifests = new Map<string, Promise<ResourceManifest>>();
  const workforce = createWorkforceClient(client);

  /**
   * The user's own workers, off their roster: each id with the flow it runs
   * on. A Lab that serves no roster flow, so refuses to open a session on it,
   * has nobody's own workers. Any other failure, a 404 from the roster's own
   * reads included, is the roster not loading.
   */
  const readOwnWorkers = async (): Promise<Section<Map<string, string>>> => {
    try {
      const entries = await workforce.roster();
      return { ok: true, value: new Map(entries.filter((entry) => !entry.standard).map((entry) => [entry.id, entry.flow])) };
    } catch (error) {
      const failure = describeFailure(error);
      return failure.httpStatus === 404 && failure.message === NO_ROSTER_FLOW ? { ok: true, value: new Map() } : { ok: false, failure };
    }
  };

  /** The manifest of `sessionId`'s flow, read once per flow. */
  const manifestFor = (flowKind: string, sessionId: string): Promise<ResourceManifest> => {
    let found = manifests.get(flowKind);
    if (found === undefined) {
      found = client.resources.getResourceManifest(sessionId);
      // A failed read is not cached: Retry reads it again.
      found.catch(() => manifests.delete(flowKind));
      manifests.set(flowKind, found);
    }
    return found;
  };

  /** Every page of one collection, through one session. */
  const readCollection = (sessionId: string, ref: string) =>
    readEveryCollectionPage(client.resources, sessionId, ref, { limit: PAGE_SIZE });

  /** A conversation's board: the user's whole ledger, read through the conversation, keeping its own partition's rows. */
  const readBoard = async (sessionId: string): Promise<BoardRow[]> => {
    const boardRef = conversationBoardRef(sessionId);
    return (await readCollection(sessionId, CONVERSATION_BOARD_COLLECTION))
      .filter((row) => conversationOfTopic(row.topic) === sessionId)
      .map((row) => toBoardRow(boardRef, sessionId, row.topic, row.clientData));
  };

  /**
   * Every board the user's conversations keep, by conversation: one read of
   * the conversation ledger through the first listed session whose flow lets
   * a browser read it, its rows grouped by the conversation that filed them.
   * Only listed conversations' boards are kept. A Lab no flow of which keeps
   * conversation boards has none, which is not a failure; a failed read is
   * one failed section, under the session it was read through.
   */
  const readConversationBoards = async (
    sessions: SessionSummary[],
  ): Promise<Array<readonly [string, Section<ConversationBoards>]>> => {
    const byFlow = new Map<string, string>();
    for (const session of sessions) {
      if (session.parentSessionId == null && !byFlow.has(session.flowKind)) byFlow.set(session.flowKind, session.id);
    }
    let carrier: string | undefined;
    try {
      for (const [flow, sessionId] of byFlow) {
        const manifest = await manifestFor(flow, sessionId);
        const declared = manifest.resources.some(
          (r) => r.kind === "collection" && r.ref === CONVERSATION_BOARD_COLLECTION && r.client.state?.read === true,
        );
        if (declared) {
          carrier = sessionId;
          break;
        }
      }
      if (carrier === undefined) return [];
      const listed = new Set(sessions.map((s) => s.id));
      const byHolder = new Map<string, BoardRow[]>();
      for (const row of await readCollection(carrier, CONVERSATION_BOARD_COLLECTION)) {
        const holder = conversationOfTopic(row.topic);
        if (!listed.has(holder)) continue;
        const rows = byHolder.get(holder) ?? [];
        rows.push(toBoardRow(conversationBoardRef(holder), holder, row.topic, row.clientData));
        byHolder.set(holder, rows);
      }
      return [...byHolder].map(
        ([holder, rows]) => [holder, { ok: true, value: { refs: [conversationBoardRef(holder)], rows } }] as const,
      );
    } catch (error) {
      return [[carrier ?? CONVERSATION_BOARD_COLLECTION, { ok: false, failure: describeFailure(error) }] as const];
    }
  };

  /**
   * Find the worker inventory through the first listed session whose flow
   * declares it, and read it there.
   */
  const readInventory = async (sessions: SessionSummary[]): Promise<Section<Inventory>> => {
    const byFlow = new Map<string, string>();
    for (const session of sessions) {
      if (session.parentSessionId == null && !byFlow.has(session.flowKind)) byFlow.set(session.flowKind, session.id);
    }
    for (const [flow, sessionId] of byFlow) {
      let manifest: ResourceManifest;
      try {
        manifest = await manifestFor(flow, sessionId);
      } catch (error) {
        return { ok: false, failure: describeFailure(error) };
      }
      const workersRef = manifest.resources.find(
        (r) => r.kind === "collection" && r.pattern === WORKER_INVENTORY_PATTERN && r.client.state?.read === true,
      )?.ref;
      if (workersRef === undefined) continue;
      try {
        const workers = (await readCollection(sessionId, workersRef))
          .map((r) => toWorker(r.clientData))
          .filter((worker): worker is Worker => worker !== undefined);
        // Every Workforce Lab's roster flow declares the workers, so none there is the Lab not having
        // opened its inventory, or these pages looking for keys it no longer writes: said below.
        if (workers.length > 0) return { ok: true, value: { workers } };
        break;
      } catch (error) {
        return { ok: false, failure: describeFailure(error) };
      }
    }
    return {
      ok: false,
      failure: {
        message:
          `No inventory to read: none of this user's sessions is on a flow that declares the organization's worker inventory (${WORKER_INVENTORY_PATTERN}) with a worker in it. Either the Lab booted without opening its inventory, or these pages are an older build than the Lab and look for keys it no longer uses: rebuild them (pnpm --filter @flow-state-dev/shift-manager build) and reload.`,
      },
    };
  };

  /**
   * The projects the user reads, once, through a session of their own whose
   * flow declares `projects/*` with a browser read: the organization's (org
   * scope) and their own private ones (user scope), each from the first flow
   * that declares it. A project needs no workstream, so neither does this read.
   *
   * `read` opens one on the roster flow for a user who holds none
   * (`withReaderSessions`). No flow declaring the collection is a Lab with no
   * projects: zero rows, not a failure (a pre-project Lab). A reading session
   * that should have been opened and couldn't is a failure, and says why; it
   * is never drawn as an empty list (D3).
   */
  const readProjects = async (sessions: SessionSummary[], readerFailure: Failure | null): Promise<Section<Projects>> => {
    const projectsRef = (manifest: ResourceManifest, scope: "org" | "user") =>
      manifest.resources.find(
        (r) => r.kind === "collection" && r.pattern === PROJECT_PATTERN && r.scope === scope && r.client.state?.read === true,
      )?.ref;
    const carriers = new Map<string, string>();
    for (const session of sessions) {
      if (session.parentSessionId == null && !carriers.has(session.flowKind)) carriers.set(session.flowKind, session.id);
    }
    try {
      const found: Partial<Record<"org" | "user", { sessionId: string; ref: string }>> = {};
      for (const [flow, sessionId] of carriers) {
        const manifest = await manifestFor(flow, sessionId);
        for (const scope of ["org", "user"] as const) {
          const ref = found[scope] === undefined ? projectsRef(manifest, scope) : undefined;
          if (ref !== undefined) found[scope] = { sessionId, ref };
        }
        if (found.org !== undefined && found.user !== undefined) break;
      }
      if (found.org === undefined && found.user === undefined) {
        if (readerFailure === null) return { ok: true, value: { rows: [] } };
        return {
          ok: false,
          failure: {
            ...readerFailure,
            message: `None of your sessions can read this Lab's projects, and one that can couldn't be opened: ${readerFailure.message}`,
          },
        };
      }
      const rowsAt = async (where: { sessionId: string; ref: string } | undefined, visibility: ProjectVisibility) =>
        where === undefined
          ? []
          : (await readCollection(where.sessionId, where.ref))
              .map((row) => toProject(row.clientData, visibility))
              .filter((p): p is Project => p !== undefined);
      // Invariant: each scope's `projects/*` is one collection, so the first
      // flow that declares it reads every row the user may, and the rest are
      // not asked.
      const [shared, own] = await Promise.all([rowsAt(found.org, "shared"), rowsAt(found.user, "private")]);
      return { ok: true, value: { rows: [...shared, ...own] } };
    } catch (error) {
      return { ok: false, failure: describeFailure(error) };
    }
  };

  /**
   * This user's sessions, with one of their own on the roster flow, which
   * declares the worker inventory, the projects and the workstream entries. A
   * user may hold only a worker's session, or none at all on a first visit,
   * and nothing of theirs can read them. It is opened once, under
   * {@link readerSessionId} so overlapping first reads can't open two, and
   * listed from then on. One that can't be opened leaves the sessions as they
   * were, with why: `null` when there is nothing to open (the Lab serves no
   * roster flow, a 404), so nothing declares what it would have read.
   */
  const withReaderSessions = async (sessions: SessionSummary[]): Promise<{ sessions: SessionSummary[]; failure: Failure | null }> => {
    const flow = PROJECT_READER_FLOW;
    if (sessions.some((s) => s.parentSessionId == null && s.flowKind === flow)) return { sessions, failure: null };
    let failure: Failure | null = null;
    try {
      let opening = openingReaders.get(client);
      if (opening === undefined) openingReaders.set(client, (opening = new Map()));
      let open = opening.get(flow);
      if (open === undefined) {
        open = openReaderSession(flow).finally(() => opening!.delete(flow));
        opening.set(flow, open);
      }
      await open;
    } catch (error) {
      const described = describeFailure(error);
      failure = described.httpStatus === 404 ? null : described;
    }
    let listed = sessions;
    try {
      listed = await client.sessions.list({ userId: client.userId, include: "dispatch-runs" });
    } catch {
      // The open landed or failed on its own; the next refresh lists it.
    }
    return { sessions: listed, failure };
  };

  /**
   * Open the user's reading session on `flow` under its one id. A 409 is
   * usually another page that opened it first, and the listing then holds it.
   * Session ids are not scoped by organization, so a 409 the listing doesn't
   * explain is that id held in another of the user's organizations: open one
   * under a fresh id.
   */
  const openReaderSession = async (flow: string): Promise<void> => {
    try {
      await client.flow(flow).createSession({ sessionId: readerSessionId(client.userId, flow) });
    } catch (error) {
      if (describeFailure(error).httpStatus !== 409) throw error;
      const listed = await client.sessions.list({ userId: client.userId });
      if (listed.some((s) => s.parentSessionId == null && s.flowKind === flow)) return;
      await client.flow(flow).createSession();
    }
  };

  /** The pending user-asks in one session. */
  const readAsks = async (session: SessionSummary, workerId: string | null): Promise<Ask[]> => {
    // A user's ask, by ER-1's one predicate: the only suspensions Inbox lists.
    const pending = (await readPendingSuspensions(client, session.id)).filter((view) => isUserSuspension(view.item));
    return pending.map((view) => ({
      sessionId: session.id,
      workerId,
      flowId: session.flowId ?? null,
      parentSessionId: session.parentSessionId ?? null,
      kind: askTypeOf(view.item),
      item: view.item,
      since: typeof view.item.ts === "number" ? view.item.ts : session.updatedAt,
      unanswerable: session.flowId == null ? UNOWNED_SESSION_UNANSWERABLE : null,
    }));
  };

  /**
   * The declared documents a listed session's flow serves to a browser: each
   * flow's manifest, read once (and cached), keeping the single resources whose
   * content a client may read. A document no flow serves, or a flow no listed
   * session runs, is not found: nothing is read but the user's own sessions.
   */
  const readResources = async (sessions: SessionSummary[]): Promise<Section<DeclaredResource[]>> => {
    const byFlow = new Map<string, string>();
    for (const session of sessions) {
      const key = session.flowId ?? session.flowKind;
      if (!byFlow.has(key)) byFlow.set(key, session.id);
    }
    const found = new Map<string, DeclaredResource>();
    try {
      for (const [key, sessionId] of byFlow) {
        const manifest = await manifestFor(key, sessionId);
        for (const entry of manifest.resources) {
          if (entry.kind === "single" && entry.client.content?.read === true && !found.has(entry.ref)) {
            found.set(entry.ref, { ref: entry.ref, sessionId });
          }
        }
      }
    } catch (error) {
      return { ok: false, failure: describeFailure(error) };
    }
    return { ok: true, value: [...found.values()].sort((a, b) => a.ref.localeCompare(b.ref)) };
  };

  const read = async (): Promise<LabSnapshot> => {
    // The first read, and the organization off it, before anything from the
    // tree is read. A 401/403, no session, or a session with no organization is
    // the refusal; any other failure means the Lab couldn't be reached. Either
    // is the whole snapshot.
    const firstFailure = (failure: Failure): LabSnapshot =>
      failure.httpStatus === 401 || failure.httpStatus === 403 ? { refused: failure } : { unreachable: failure };
    let sessions: SessionSummary[];
    try {
      sessions = await client.sessions.list({ userId: client.userId, include: "dispatch-runs" });
    } catch (error) {
      return firstFailure(describeFailure(error));
    }
    // Before the organization is read, on purpose, even though a Lab with no
    // reader flow answers it 404 on every refused read: a reading session is
    // the only session a first-visit user can have for the org to be read off.
    const readers = await withReaderSessions(sessions);
    sessions = readers.sessions;
    let orgId: string | undefined;
    try {
      const first = sessions[0];
      const opened = readers.failure;
      if (first === undefined) return opened === null ? { refused: { message: noOrganization(client.userId) } } : firstFailure(opened);
      orgId = (await client.sessions.get(first.id)).orgId;
    } catch (error) {
      return firstFailure(describeFailure(error));
    }
    if (typeof orgId !== "string" || orgId.length === 0) return { refused: { message: noOrganization(client.userId, "their session records none") } };

    const [inventory, ownWorkers] = await Promise.all([readInventory(sessions), readOwnWorkers()]);

    const [conversationBoards, asks, resources, projects] = await Promise.all([
      readConversationBoards(sessions),
      (async (): Promise<Section<Ask[]>> => {
        if (!inventory.ok) {
          return { ok: false, failure: { message: `Asks are read from worker sessions, and the worker inventory did not load. ${inventory.failure.message}` } };
        }
        if (!ownWorkers.ok) {
          return { ok: false, failure: { message: `Asks are read from your own workers' sessions too, and your roster did not load. ${ownWorkers.failure.message}` } };
        }
        // A worker's sessions are on its worker flow, and name the worker in
        // their state. One on a worker's flow that names none is still read: its
        // asks are shown, unattributed. A session naming one of the user's
        // own workers, on the flow their roster says it runs on, is that
        // worker's: the listing holds only the user's sessions, so it is
        // their own worker's and nobody else's. Another flow's session that
        // merely names it in its state is not.
        const workerIds = new Set(inventory.value.workers.map((s) => s.id));
        const workerFlowNames = new Set(inventory.value.workers.map((s) => s.kind).filter((k): k is string => k !== null));
        const workerSessions = sessions.flatMap((s): Array<{ session: SessionSummary; workerId: string | null }> => {
          const workerId = workerOf(s);
          if (workerId !== null && ownWorkers.value.get(workerId) === s.flowKind) return [{ session: s, workerId: workerId }];
          if (!workerFlowNames.has(s.flowKind)) return [];
          if (workerId === null) return [{ session: s, workerId: null }];
          return workerIds.has(workerId) ? [{ session: s, workerId: workerId }] : [];
        });
        try {
          const found = await inBatches(workerSessions, ASK_READ_BATCH, ({ session, workerId }) => readAsks(session, workerId));
          return { ok: true, value: found.flat().sort((a, b) => a.since - b.since) };
        } catch (error) {
          return { ok: false, failure: describeFailure(error) };
        }
      })(),
      readResources(sessions),
      readProjects(sessions, readers.failure),
    ]);

    const boards = Object.fromEntries(conversationBoards);
    return {
      readAt: Date.now(),
      sessions,
      orgId,
      inventory,
      projects,
      boards,
      asks,
      inbox: inboxSection(asks, boards, sessions),
      resources,
    };
  };

  // The answer route (FIX-2129): the Lab sets who answered, and checks the
  // ask is this user's before it reads it.
  const inbox = createInboxClient(client);
  const resume: LabReader["resume"] = async (ask, answer) => {
    if (ask.flowId === null) throw new Error(UNOWNED_SESSION_UNANSWERABLE);
    // Orchestration's one answer call, as the Inbox makes it for an item's hold:
    // the card's resolution read as the answer its ask takes.
    const asks = suspendForUserKindOf(ask.item) ?? "input";
    const typed: InboxAnswer =
      asks === "approval"
        ? { approved: answer.action === "approve", ...(answer.data === undefined ? {} : { data: answer.data }) }
        : answer.action === "skip"
          ? { skipped: true }
          : { value: answer.data };
    await inbox.answerOne(
      {
        id: ask.item.suspensionId,
        source: { kind: "suspension", flowId: ask.flowId, sessionId: ask.sessionId, requestId: ask.item.requestId, suspensionId: ask.item.suspensionId },
        ask: { kind: asks, prompt: ask.item.message },
        openedAt: ask.since,
        answerable: true,
        unanswerable: null,
      },
      typed,
    );
  };

  const answerOne: LabReader["answerOne"] = (hold, answer) => inbox.answerOne(hold, answer);

  return { read, readBoard, resume, answerOne };
}
