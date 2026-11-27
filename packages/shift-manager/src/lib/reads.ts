// BR-3; BR-10; BR-11.
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
 *    and nothing else is read.
 * 2. **The organization**, from the roster flow's identity read: the user
 *    and organization the Lab acts as under that flow's sign-in, with no
 *    session. A Lab that serves no roster flow names no organization, and
 *    gets the refusal too: Shift Manager never draws a Lab under an unknown
 *    one (ER-4).
 * 3. **The inventory**: the organization's worker collection, read by org
 *    scope and its published key pattern with no session; every flow that
 *    declares it (the roster flow does) serves the one collection. Nothing
 *    about the tree is written in Shift Manager; this is where every worker
 *    and team name comes from.
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
 *    manifest, for Jump to.
 * 7. **The projects the user reads**: every row of the organization's
 *    `projects` collection and of their own private one, read by scope and
 *    the published key pattern with no session (the roster flow declares
 *    both). PROJECTS lists them. A project's
 *    workstream entries are never read here: a project's view reads them, by
 *    its one prefix, when it opens (`projects.ts`).
 *
 * Every read after the first fails on its own: a failed section carries its
 * failure and the rest of the snapshot is whole. Nothing retries by
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
import type { BoardTask } from "@flow-state-dev/workforce/browser";
import type { FileContent, OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import { isUserSuspension, suspendForUserKindOf, type ResumeAction } from "@flow-state-dev/core/types";
import { suspensionShape } from "@flow-state-dev/react";
import { deriveSuspensions } from "@flow-state-dev/react/internal";
import { PROJECTS_PATTERN, ROSTER_FLOW, sessionIdOfFiling } from "@flow-state-dev/workforce/browser";
import { boardTaskOf, createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { describeFailure, type Failure, type Section } from "./failure";
import { CONVERSATION_BOARD_COLLECTION, conversationBoardRef, type BoardTaskView } from "./boards";
import { toProject, type Project, type ProjectVisibility } from "./project";
import { toWorker, workerOf, type Worker } from "./workers";
import type { Client } from "@flow-state-dev/client";
import { createInboxClient, inboxItems, suspensionHoldId, taskActionName, type BoardActions, type InboxAnswer, type InboxHold, type InboxItem, type InboxTaskInput, type TaskHold } from "@flow-state-dev/orchestration/inbox";

/** The projects the user reads: the organization's, and their own private ones. */
export type Projects = {
  /** Every row: the shared ones in the collection's order, then the private ones. */
  rows: Project[];
};

/** The run working a task, or the run that last worked it: workforce's board task names it. */
export type RunLink = NonNullable<BoardTask["run"]>;

/** A conversation's board and every row on it. */
export type ConversationBoards = { refs: string[]; rows: BoardTaskView[] };

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
  // FIX-2129.
  /**
   * Why this ask can't be answered from Shift Manager, or `null` when it can.
   * Shown on the card; the card offers no answer when it is set. Every ask
   * answers through the Lab's answer route, whatever started its
   * run, a task's included: only one whose session names no flow can't.
   */
  unanswerable: string | null;
};

/**
 * Why a Lab is refused when nothing it serves says which organization the
 * user is in: it serves no roster flow to ask the identity read under, or the
 * identity read names none.
 */
function noOrganization(userId: string, why = "it serves no roster flow to ask it under"): string {
  return `The Lab names no organization for ${userId}: ${why}. Shift Manager asks the roster flow's identity read which organization the Lab puts them in; its README lists what a Lab serves.`;
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
      // BR-10.
      /** The declared documents Jump to finds and opens read-only. */
      resources: Section<DeclaredResource[]>;
    };

/** The organization's worker inventory, by its published key pattern. */
const WORKER_INVENTORY_PATTERN = "inventory/workers/*";


/** Rows per collection page: the collection route's maximum. */
const PAGE_SIZE = 200;
/** A guard against a server that pages suspension items forever; collection reads use the client's shared ceiling. */
const MAX_PAGES = 1000;
/** Suspension items per session-state page. */
const ASK_PAGE_SIZE = 200;
/** How many worker sessions are read at once. */
const ASK_READ_BATCH = 6;

/**
 * What the Lab answers a call on a flow it doesn't serve, for the roster
 * flow's view: the engine's unknown-flow message. Matched exactly, so any
 * other 404 (the roster flow answering for its view) is a failure, not "no roster".
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

// FIX-2774: workforce's `boardTaskOf` is the one mapper; the inbox view reads tasks through it too.
// The snapshot's boards, and this wrapper with them, go with FIX-2775/2776.
/**
 * A board's task, from what the board publishes.
 *
 * `title` is never absent: a row filed with none reads its goal there. The
 * Brief's `distinctTitle` (`lib/tasks.ts`) is written against that, and shows
 * a title only when it differs from `goal`.
 */
export function toBoardTaskView(boardRef: string, ownerSessionId: string, topic: string, stored: unknown): BoardTaskView {
  return boardTaskOf(boardRef, ownerSessionId, topic, stored);
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
  const rows: BoardTaskView[] = [];
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

// FIX-2133.
/**
 * Where a row's questions are answered: the board's `updateTask`
 * action on the conversation that holds it, as the signed-in user, named by
 * orchestration's `taskActionName`. A board that isn't a conversation's has
 * no action Shift Manager names: `null`, and its questions read as
 * unanswerable here.
 */
function boardOwnerOf(row: BoardTaskView): InboxTaskInput["holder"] {
  return row.boardRef === conversationBoardRef(row.ownerSessionId)
    ? { sessionId: row.ownerSessionId, action: taskActionName("updateTask", CONVERSATION_BOARD_COLLECTION) }
    : null;
}

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
  readBoard(sessionId: string): Promise<BoardTaskView[]>;
  /**
   * Answer an ask through its session's owning flow. Rejects when the session
   * names no owner, or when the Lab refuses the answer.
   */
  resume(ask: Ask, answer: { action: ResumeAction; data?: unknown }): Promise<void>;
  // FIX-2133.
  /**
   * Answer one of an Inbox item's holds through orchestration's one answer
   * call, routed by its source: a task's question or confirm through its
   * board's `updateTask`, as the user. Rejects with the board's
   * refusal.
   */
  answerOne(hold: InboxHold<unknown>, answer: InboxAnswer): Promise<void>;
  // FIX-2381.
  /**
   * The task actions of `conversation`'s board: cancel, steer,
   * release, retry and re-file, orchestration's `inbox.board(...)` bound to
   * the conversation's session and the flow that owns it, as the signed-in
   * user. Each rejects with the board's refusal. A conversation whose session
   * names no owning flow has no board to act on, so it can't be passed here.
   */
  taskActions(conversation: { id: string; flowId: string }): BoardActions;
};

/** Build the reader for one connection. */
export function createLabReader(client: Client): LabReader {
  const manifests = new Map<string, Promise<ResourceManifest>>();
  const workforce = createWorkforceClient(client);

  /**
   * The user's own workers, off their roster: each id with the flow it runs
   * on. A Lab that serves no roster flow, so refuses the roster view as an
   * unknown flow, has nobody's own workers. Any other failure, a 404 the
   * roster flow answers included, is the roster not loading.
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
  const readBoard = async (sessionId: string): Promise<BoardTaskView[]> => {
    const boardRef = conversationBoardRef(sessionId);
    return (await readCollection(sessionId, CONVERSATION_BOARD_COLLECTION))
      .filter((row) => conversationOfTopic(row.topic) === sessionId)
      .map((row) => toBoardTaskView(boardRef, sessionId, row.topic, row.clientData));
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
      const byHolder = new Map<string, BoardTaskView[]>();
      for (const row of await readCollection(carrier, CONVERSATION_BOARD_COLLECTION)) {
        const holder = conversationOfTopic(row.topic);
        if (!listed.has(holder)) continue;
        const rows = byHolder.get(holder) ?? [];
        rows.push(toBoardTaskView(conversationBoardRef(holder), holder, row.topic, row.clientData));
        byHolder.set(holder, rows);
      }
      return [...byHolder].map(
        ([holder, rows]) => [holder, { ok: true, value: { refs: [conversationBoardRef(holder)], rows } }] as const,
      );
    } catch (error) {
      return [[carrier ?? CONVERSATION_BOARD_COLLECTION, { ok: false, failure: describeFailure(error) }] as const];
    }
  };

  // FIX-2624.
  /**
   * The organization's worker inventory, read by org scope with no session:
   * every flow that declares it (the roster flow does) serves the one
   * collection. None declaring it answers 404.
   */
  const readInventory = async (): Promise<Section<Inventory>> => {
    try {
      const workers = (await client.resource({ scope: "org", pattern: WORKER_INVENTORY_PATTERN }).listAll({ limit: PAGE_SIZE }))
        .map((r) => toWorker(r.value))
        .filter((worker): worker is Worker => worker !== undefined);
      // Every Workforce Lab's roster flow declares the workers, so none there is the Lab not having
      // opened its inventory, or these pages looking for keys it no longer writes: said below.
      if (workers.length > 0) return { ok: true, value: { workers } };
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.httpStatus !== 404) return { ok: false, failure };
    }
    return {
      ok: false,
      failure: {
        message:
          `No inventory to read: none of this Lab's flows declares the organization's worker inventory (${WORKER_INVENTORY_PATTERN}) with a worker in it. Either the Lab booted without opening its inventory, or these pages are an older build than the Lab and look for keys it no longer uses: rebuild them (pnpm --filter @flow-state-dev/shift-manager build) and reload.`,
      },
    };
  };

  // FIX-2624.
  /**
   * The projects the user reads, by scope and the published key pattern with
   * no session: the organization's (org scope) and their own private ones
   * (user scope). Every flow that declares a scope's `projects/*` serves the
   * one collection. A project needs no workstream, so neither does this read.
   *
   * None declaring a scope's collection (a 404) is a Lab with no projects
   * there: zero rows, not a failure (a pre-project Lab). Any other failure
   * says why; it is never drawn as an empty list (D3).
   */
  const readProjects = async (): Promise<Section<Projects>> => {
    const rowsAt = async (scope: "org" | "user", visibility: ProjectVisibility) => {
      try {
        return (await client.resource({ scope, pattern: PROJECTS_PATTERN }).listAll({ limit: PAGE_SIZE }))
          .map((row) => toProject(row.value, visibility))
          .filter((p): p is Project => p !== undefined);
      } catch (error) {
        if (describeFailure(error).httpStatus === 404) return [];
        throw error;
      }
    };
    try {
      const [shared, own] = await Promise.all([rowsAt("org", "shared"), rowsAt("user", "private")]);
      return { ok: true, value: { rows: [...shared, ...own] } };
    } catch (error) {
      return { ok: false, failure: describeFailure(error) };
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
    // FIX-2624: the organization is the identity read's, under the roster
    // flow's sign-in, with no session. A Lab that serves no roster flow names
    // none, and Shift Manager never draws a Lab under an unknown one (ER-4).
    let orgId: string | undefined;
    try {
      orgId = (await client.flow(ROSTER_FLOW).identity()).orgId;
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.httpStatus === 404 && failure.message === NO_ROSTER_FLOW) return { refused: { message: noOrganization(client.userId) } };
      return firstFailure(failure);
    }
    if (typeof orgId !== "string" || orgId.length === 0) return { refused: { message: noOrganization(client.userId, "its identity read names none") } };

    const [inventory, ownWorkers] = await Promise.all([readInventory(), readOwnWorkers()]);

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
      readProjects(),
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
        id: suspensionHoldId(ask.item.requestId, ask.item.suspensionId),
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

  const taskActions: LabReader["taskActions"] = (conversation) =>
    inbox.board({ flowId: conversation.flowId, sessionId: conversation.id, board: CONVERSATION_BOARD_COLLECTION });

  return { read, readBoard, resume, answerOne, taskActions };
}
