/**
 * The one module every Shift Manager surface reads the Lab through.
 *
 * A refresh makes each read once and hands back one snapshot. Counts, badges
 * and screens all draw from that snapshot, so the sidebar's Inbox count and
 * the Inbox list can never disagree, and a Lab with dozens of seats costs one
 * listing and one ask read per seat session, not one per badge.
 *
 * What a refresh reads, in order:
 *
 * 1. **The person's sessions**, dispatch runs included. A seat woken by a
 *    mailbox post runs in a dispatch-run session, which the default listing
 *    leaves out, so without `include: "dispatch-runs"` that seat's ask would
 *    be invisible. This is also Shift Manager's first read: when the Lab refuses it
 *    for want of a verified organization, the snapshot is only that refusal
 *    and nothing else is read (BR-3).
 * 2. **The organization**, off a listed session. The listing only ever holds
 *    sessions in the organization the Lab resolved for the person, and a
 *    session records it. A person who holds no session of their own on the
 *    mailbox kind or the roster flow yet has one opened on each first
 *    (`withReaderSessions`), and the Lab stamps it with the organization it
 *    resolves for them, so a member on a first visit is read like any other.
 *    A Lab that still lists the person no session (it serves neither) names
 *    no organization, and gets the refusal too: Shift Manager never draws a
 *    Lab under an unknown one (ER-4).
 * 3. **The inventory**: the organization's seat and mailbox collections, found
 *    by their published key patterns in the manifest of a listed session whose
 *    flow declares them (the mailbox kind does). Nothing about the tree is
 *    written in Shift Manager; this is where every seat, team and workstream name
 *    comes from.
 * 4. **Each workstream's attached boards**: the mailbox kind's manifest lists
 *    one collection per attached board, `<mailboxId>.<name>`, read through the
 *    mailbox's own session.
 * 5. **Pending asks**: for each listed session a seat owns, the suspension
 *    items only, reduced by `react`'s `deriveSuspensions` to the ones still
 *    pending. Not the transcript. A seat is one the inventory registers, or
 *    one of the person's own workers: those are on their roster, never in the
 *    inventory, so the roster is read first, through Workforce's `roster()`,
 *    which answers for the caller only.
 * 6. **Declared documents** a browser may read, from each listed flow's
 *    manifest, for Jump to (BR-10).
 * 7. **The projects the person reads**: every row of the organization's
 *    `projects` collection and of their own private one, found by the
 *    published key pattern and scope on a flow the person holds a session of
 *    (the roster flow declares both). PROJECTS lists them. A project's
 *    workstream entries are never read here: a project's view reads them, by
 *    its one prefix, when it opens (`projects.ts`).
 *
 * Every read after the first fails on its own: a failed section carries its
 * failure and the rest of the snapshot is whole (BR-11). Nothing retries by
 * itself, and nothing is filled in from a guess.
 *
 * Manifests are static per flow kind, so they are cached across refreshes by
 * kind, never re-read per screen.
 *
 * The one answer path, {@link LabReader.resume}, is here too, so Inbox and a
 * workstream's Stream resolve an ask the same way: through the flow the ask's
 * session records as its owner (`flowId`), never the board's.
 */
import { ClientHttpError, readEveryCollectionPage, type ResourceManifest, type SessionSummary } from "@flow-state-dev/client";
import type { OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import type { ResumeAction } from "@flow-state-dev/core/types";
import { deriveSuspensions, suspensionShape } from "@flow-state-dev/react";
import { ROSTER_FLOW_KIND, WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { workforceClientFor, type LabClients } from "./connection";

/** Why a read did not load. */
export type Failure = { message: string; httpStatus?: number };

/**
 * The worker a session runs, as its state names it (`workerId`), or `null`
 * when it names none.
 */
export function workerOf(session: SessionSummary): string | null {
  return text(field((session as { state?: unknown }).state, WORKER_ID_STATE_KEY));
}

/** One section's outcome: its value, or why it has none. */
export type Section<T> = { ok: true; value: T } | { ok: false; failure: Failure };

/** A seat, as the seat inventory registers it: one worker. */
export type Seat = {
  /**
   * The worker's id: `<team>.<name>`, or a bare name for an org seat. Boards
   * and mailboxes name the seat by it, and its sessions carry it as their
   * `workerId`.
   */
  id: string;
  /** The worker flow the worker runs on, which is also that flow's copy id; `null` on a row that has none. */
  kind: string | null;
  /**
   * The action that takes a person's message into this seat's sessions, as
   * the hire published it; `null` when its kind takes none, or on a row
   * written before doors were published.
   */
  door: string | null;
  /** The team it sits under, or {@link STAFF_TEAM} for an org seat (see {@link toSeat}). */
  team: string;
  name: string;
};

/** A workstream: a declared mailbox, as the mailbox inventory registers it (D2). */
export type Workstream = {
  /** The mailbox's id, which is its session id and its address in Shift Manager. */
  id: string;
  /** The mailbox's flow kind. */
  kind: string | null;
  /** The seat ids the mailbox declares as members. */
  members: string[];
};

/** Where a project lives: the organization's, or the person's own. */
export type ProjectVisibility = "shared" | "private";

/**
 * A project: a row of the organization's `projects` collection (shared), or of
 * the person's own (private). It names no team; the mailbox workstreams it
 * lists are mailbox ids from any team. Its address is its visibility and its
 * id: a private project and a shared one can share an id.
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
  /** The mailbox ids the project holds, as the row lists them. */
  workstreams: string[];
  /**
   * The git remote the project's code lives in, or `null` when it has none
   * (its coding work runs on its files). A row written before the field
   * existed reads as none.
   */
  repository: string | null;
};

/** The projects the person reads: the organization's, and their own private ones. */
export type Projects = {
  /** Every row: the shared ones in the collection's order, then the private ones. */
  rows: Project[];
};

/**
 * The run working a task, or the run that last worked it: the session a
 * handed-off attempt runs in, that attempt's request there, and the attempt
 * number. The board's claim gate writes it from inside the run; the next claim
 * clears it. It carries no flow: the run's flow is the one its session records
 * as its owner.
 */
export type RunLink = { sessionId: string; requestId: string; attempt: number };

/** One row on an attached board, with the fields a board publishes to a browser. */
export type BoardRow = {
  /** The board's collection ref, `<mailboxId>.<name>`. */
  boardRef: string;
  mailboxId: string;
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
  createdAt: number | null;
  updatedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
};

/** A workstream's attached boards and every row on them. */
export type WorkstreamBoards = { refs: string[]; rows: BoardRow[] };

/** A pending approval or question, and the session that holds it. */
export type Ask = {
  /** The seat session the ask waits in. */
  sessionId: string;
  /** The seat that asked, when the session names its owner. */
  seatId: string | null;
  /**
   * The flow instance that owns the session, which is what the answer goes
   * through. `null` on a session written before instance ownership: its ask
   * is shown, and its answer is unavailable.
   */
  flowId: string | null;
  /** The session that started this run, for a dispatch run (a mailbox, when a post woke the seat). */
  parentSessionId: string | null;
  kind: "approval" | "question";
  item: SuspensionItem;
  /** When the ask was raised, epoch ms. */
  since: number;
  /**
   * Why this ask can't be answered from Shift Manager, or `null` when it can.
   * Shown on the card; the card offers no answer when it is set.
   */
  unanswerable: string | null;
};

/**
 * The request sources the Lab reopens through its public resume route: the
 * engine's own allow-list (`http`, `mcp`, `scheduled`), mirrored here because
 * Shift Manager runs in a browser and can't import the engine. A test pins this set
 * to the engine's exported one, so the two can't drift apart unnoticed.
 *
 * An allow-list, like the engine's: any other source, and a request with no
 * source at all, is shown as unanswerable rather than offered a button the
 * Lab will refuse. A host that adds its own transport to the engine's list
 * (`publicReentrySources`) is shown unanswerable here too, which is the
 * visible failure rather than the silent one; the server saying per request
 * whether it will reopen it is FIX-1671's.
 */
export const REOPENED_SOURCES: ReadonlySet<string> = new Set(["http", "mcp", "scheduled"]);

/** What an ask's card says when its run can't be reopened from outside the Lab. */
export const DISPATCHED_RUN_UNANSWERABLE =
  "This ask can't be answered from Shift Manager. The Lab reopens only runs a person, an MCP caller or a schedule started; a run it started by itself (a mailbox post waking a seat, a dispatch, a webhook) is never reopened from outside it.";

/**
 * Why a Lab that lists the person no session, even after one was asked for on
 * the reader kinds, is refused: nothing it serves says which organization they are in.
 */
function noOrganization(userId: string, why = "it holds no session of theirs and serves no mailbox kind or roster flow to open one on"): string {
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

/** The organization's seats and workstreams, as the inventory registers them. */
export type Inventory = {
  /** Every seat the inventory registers. */
  seats: Seat[];
  workstreams: Workstream[];
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
      /** The person's listed sessions, dispatch runs included. */
      sessions: SessionSummary[];
      /** The organization the Lab bound this person's sessions to. */
      orgId: string;
      inventory: Section<Inventory>;
      /**
       * The organization's projects. A Lab whose flows declare no projects
       * collection has none, which is not a failure: every workstream is then
       * under No project.
       */
      projects: Section<Projects>;
      /** Per workstream id. Absent for a workstream when the inventory did not load. */
      boards: Record<string, Section<WorkstreamBoards>>;
      asks: Section<Ask[]>;
      /** The declared documents Jump to finds and opens read-only (BR-10). */
      resources: Section<DeclaredResource[]>;
    };

/** The organization's inventory collections, by their published key patterns. */
const INVENTORY_PATTERNS = { seats: "inventory/seats/*", mailboxes: "inventory/mailboxes/*" } as const;

/**
 * The flow kind a person's own session for reading the organization's
 * inventory is opened on, when they hold none: workforce's built-in mailbox
 * kind (`MAILBOX_KIND`), which declares the inventory until mailboxes become
 * workstreams. Spelled here because the workforce browser entry doesn't export
 * it; `static.test.ts` pins the two together.
 */
export const INVENTORY_READER_KIND = "mailbox";

/**
 * The flow a person's own session for reading their projects and the
 * workstream entries is opened on, when they hold none: workforce's roster
 * flow, which declares the projects at both scopes and the entries.
 */
export const PROJECT_READER_KIND = ROSTER_FLOW_KIND;

/**
 * The projects, by their published key pattern: one pattern, at the
 * organization's scope for the shared ones and the person's for their own.
 */
const PROJECT_PATTERN = "projects/*";

/** Rows per collection page: the collection route's maximum. */
const PAGE_SIZE = 200;
/** A guard against a server that pages suspension items forever; collection reads use the client's shared ceiling. */
const MAX_PAGES = 1000;
/** Suspension items per session-state page. */
const ASK_PAGE_SIZE = 200;
/** How many seat sessions are read at once. */
const ASK_READ_BATCH = 6;

/**
 * What the Lab answers a session open on a flow kind it doesn't serve, for the
 * roster flow: the engine's unknown-flow message. Matched exactly, so any
 * other 404 (the roster session's own reads) is a failure, not "no roster".
 */
const NO_ROSTER_FLOW = `Unknown flow "${ROSTER_FLOW_KIND}"`;

/** The suspension reasons that are a person's ask: the only ones Inbox lists. */
export const PERSON_REASONS: ReadonlySet<string> = new Set(["human_approval", "human_input"]);

/** One still-pending suspension, as `deriveSuspensions` reduces it. */
export type PendingSuspension = ReturnType<typeof deriveSuspensions>["pending"][number];

/**
 * The suspensions still pending in one session: every page of its suspension
 * and resume items, reduced by `react`'s `deriveSuspensions`. Inbox lists its
 * asks from this read.
 */
export async function readPendingSuspensions(clients: LabClients, sessionId: string): Promise<PendingSuspension[]> {
  const items: OutputItem[] = [];
  for (let offset = 0, page = 0; page < MAX_PAGES; page += 1) {
    const state = await clients.sessions.getSessionState(sessionId, {
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
 * The group an org seat sits in: a seat whose address has no team, such as a
 * chief of staff or Ops. Capitalised, so no team id (lowercase by Workforce's
 * segment rule) can be it.
 */
export const STAFF_TEAM = "Staff";

/**
 * A seat inventory row, grouped by its worker id:
 *
 * - `<team>.<name>` sits under its team: a team id carries no dot, so the team
 *   is everything before the first one;
 * - an id with no dot is an org seat, and sits in {@link STAFF_TEAM}.
 */
export function toSeat(row: unknown): Seat | undefined {
  const id = text(field(row, "id"));
  if (id === null) return undefined;
  const dot = id.indexOf(".");
  const team = dot > 0 ? id.slice(0, dot) : STAFF_TEAM;
  const name = dot > 0 ? id.slice(dot + 1) : id;
  return { id, kind: text(field(row, "kind")), door: text(field(row, "door")), team, name };
}

/** A mailbox inventory row. A row written before `members` existed reads as none (BP-030). */
export function toWorkstream(row: unknown): Workstream | undefined {
  const id = text(field(row, "id"));
  if (id === null) return undefined;
  const members = field(row, "members");
  return {
    id,
    kind: text(field(row, "kind")),
    members: Array.isArray(members) ? members.filter((m): m is string => typeof m === "string") : [],
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
    workstreams: strings(field(row, "workstreams")),
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

/** A board row, from what the board publishes. */
export function toBoardRow(boardRef: string, mailboxId: string, topic: string, data: unknown): BoardRow {
  return {
    boardRef,
    mailboxId,
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
    createdAt: time(field(data, "createdAt")),
    updatedAt: time(field(data, "updatedAt")),
    startedAt: time(field(data, "startedAt")),
    completedAt: time(field(data, "completedAt")),
  };
}

/**
 * The board refs a mailbox's manifest lists for that mailbox: collections
 * keyed `<mailboxId>.<name>/**` where the name carries no dot. The split is
 * exact because a board name may not contain one, so `a.b.c` belongs to `a.b`
 * and never to `a`.
 */
export function boardRefsFor(mailboxId: string, manifest: ResourceManifest): string[] {
  const prefix = `${mailboxId}.`;
  return manifest.resources
    .filter(
      (entry) =>
        entry.kind === "collection" &&
        entry.client.state?.read === true &&
        entry.ref.startsWith(prefix) &&
        !entry.ref.slice(prefix.length).includes(".") &&
        entry.pattern === `${entry.ref}/**`,
    )
    .map((entry) => entry.ref);
}

/** Run `task` over `inputs`, `size` at a time, keeping order. */
async function inBatches<T, R>(inputs: readonly T[], size: number, task: (input: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < inputs.length; i += size) {
    out.push(...(await Promise.all(inputs.slice(i, i + size).map(task))));
  }
  return out;
}

/** Reads one Lab. Holds only the per-kind manifest cache between refreshes. */
export type LabReader = {
  /** One refresh: every read once. */
  read(): Promise<LabSnapshot>;
  /** Re-read one workstream's one board, for a screen waiting on a row to move. */
  readBoard(mailboxId: string, boardRef: string): Promise<BoardRow[]>;
  /**
   * Answer an ask through its session's owning flow. Rejects when the session
   * names no owner, or when the Lab refuses the answer.
   */
  resume(ask: Ask, answer: { action: ResumeAction; data?: unknown }): Promise<void>;
};

/**
 * The id of `userId`'s own reading session on `kind`: one per person per kind,
 * so two first visits at once (two tabs) open the same session rather than two.
 */
export function readerSessionId(userId: string, kind: string): string {
  return `${kind}-own-${userId}`;
}

/**
 * Reading-session opens in flight, per client and kind, so reads that overlap
 * on one page (StrictMode replaying the boot) share one open rather than racing it.
 */
const openingReaders = new WeakMap<LabClients, Map<string, Promise<void>>>();

/** Build the reader for one connection. */
export function createLabReader(clients: LabClients): LabReader {
  const manifests = new Map<string, Promise<ResourceManifest>>();
  const workforce = workforceClientFor(clients);

  /**
   * The person's own workers, off their roster: each id with the flow it runs
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

  /** The manifest of `sessionId`'s flow kind, read once per kind. */
  const manifestFor = (flowKind: string, sessionId: string): Promise<ResourceManifest> => {
    let found = manifests.get(flowKind);
    if (found === undefined) {
      found = clients.resources.getResourceManifest(sessionId);
      // A failed read is not cached: Retry reads it again.
      found.catch(() => manifests.delete(flowKind));
      manifests.set(flowKind, found);
    }
    return found;
  };

  /** Every page of one collection, through one session. */
  const readCollection = (sessionId: string, ref: string) =>
    readEveryCollectionPage(clients.resources, sessionId, ref, { limit: PAGE_SIZE });

  const readBoard = async (mailboxId: string, boardRef: string): Promise<BoardRow[]> =>
    (await readCollection(mailboxId, boardRef)).map((row) => toBoardRow(boardRef, mailboxId, row.topic, row.clientData));

  /** Find the inventory through the first listed session whose flow declares it. */
  const readInventory = async (sessions: SessionSummary[]): Promise<Section<Inventory>> => {
    const byKind = new Map<string, string>();
    for (const session of sessions) {
      if (session.parentSessionId == null && !byKind.has(session.flowKind)) byKind.set(session.flowKind, session.id);
    }
    for (const [kind, sessionId] of byKind) {
      let manifest: ResourceManifest;
      try {
        manifest = await manifestFor(kind, sessionId);
      } catch (error) {
        return { ok: false, failure: describeFailure(error) };
      }
      const refOf = (pattern: string) =>
        manifest.resources.find((r) => r.kind === "collection" && r.pattern === pattern && r.client.state?.read === true)
          ?.ref;
      const seatsRef = refOf(INVENTORY_PATTERNS.seats);
      const mailboxesRef = refOf(INVENTORY_PATTERNS.mailboxes);
      if (seatsRef === undefined || mailboxesRef === undefined) continue;
      try {
        const [seatRows, mailboxRows] = await Promise.all([
          readCollection(sessionId, seatsRef),
          readCollection(sessionId, mailboxesRef),
        ]);
        const seats = seatRows.map((r) => toSeat(r.clientData)).filter((seat): seat is Seat => seat !== undefined);
        const workstreams = mailboxRows
          .map((r) => toWorkstream(r.clientData))
          .filter((w): w is Workstream => w !== undefined);
        if (seats.length === 0 && workstreams.length === 0) {
          return {
            ok: false,
            failure: {
              message:
                "The Lab's inventory is empty: it registers no seats and no mailboxes. The Lab booted without opening its inventory.",
            },
          };
        }
        return { ok: true, value: { seats, workstreams } };
      } catch (error) {
        return { ok: false, failure: describeFailure(error) };
      }
    }
    return {
      ok: false,
      failure: {
        message:
          `No inventory to read: none of this person's sessions is on a flow that declares the organization's seat and mailbox inventory (${INVENTORY_PATTERNS.seats}, ${INVENTORY_PATTERNS.mailboxes}). Either the Lab booted without opening its inventory, or these pages are an older build than the Lab and look for keys it no longer uses: rebuild them (pnpm --filter @flow-state-dev/shift-manager build) and reload.`,
      },
    };
  };

  /**
   * The projects the person reads, once, through a session of their own whose
   * flow declares `projects/*` with a browser read: the organization's (org
   * scope) and their own private ones (user scope), each from the first flow
   * that declares it. A project needs no workstream, so neither does this read.
   *
   * `read` opens one on the roster flow for a person who holds none
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
      for (const [kind, sessionId] of carriers) {
        const manifest = await manifestFor(kind, sessionId);
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
      // kind that declares it reads every row the person may, and the rest are
      // not asked.
      const [shared, own] = await Promise.all([rowsAt(found.org, "shared"), rowsAt(found.user, "private")]);
      return { ok: true, value: { rows: [...shared, ...own] } };
    } catch (error) {
      return { ok: false, failure: describeFailure(error) };
    }
  };

  /**
   * This person's sessions, with one of their own on each reader kind: the
   * mailbox kind, which declares the organization's inventory, and the roster
   * flow, which declares the projects and the workstream entries. A person may
   * hold only a seat's session, or none at all on a first visit, and nothing
   * of theirs can read either. Each is opened once, under
   * {@link readerSessionId} so overlapping first reads can't open two, and
   * listed from then on. One that can't be opened leaves the sessions as they
   * were, with why: `null` when there is nothing to open (the Lab serves no
   * such kind, a 404), so nothing declares what it would have read.
   */
  const withReaderSessions = async (
    sessions: SessionSummary[],
  ): Promise<{ sessions: SessionSummary[]; inventory: Failure | null; projects: Failure | null }> => {
    const missing = [INVENTORY_READER_KIND, PROJECT_READER_KIND].filter(
      (kind) => !sessions.some((s) => s.parentSessionId == null && s.flowKind === kind),
    );
    if (missing.length === 0) return { sessions, inventory: null, projects: null };
    const failures = new Map<string, Failure | null>();
    await Promise.all(
      missing.map(async (kind) => {
        try {
          let opening = openingReaders.get(clients);
          if (opening === undefined) openingReaders.set(clients, (opening = new Map()));
          let open = opening.get(kind);
          if (open === undefined) {
            open = openReaderSession(kind).finally(() => opening!.delete(kind));
            opening.set(kind, open);
          }
          await open;
        } catch (error) {
          const failure = describeFailure(error);
          failures.set(kind, failure.httpStatus === 404 ? null : failure);
        }
      }),
    );
    let listed = sessions;
    try {
      listed = await clients.sessions.listSessions({ userId: clients.userId, include: "dispatch-runs" });
    } catch {
      // The opens landed or failed on their own; the next refresh lists them.
    }
    return {
      sessions: listed,
      inventory: failures.get(INVENTORY_READER_KIND) ?? null,
      projects: failures.get(PROJECT_READER_KIND) ?? null,
    };
  };

  /**
   * Open the person's reading session on `kind` under its one id. A 409 is
   * usually another page that opened it first, and the listing then holds it.
   * Session ids are not scoped by organization, so a 409 the listing doesn't
   * explain is that id held in another of the person's organizations: open one
   * under a fresh id.
   */
  const openReaderSession = async (kind: string): Promise<void> => {
    try {
      await clients.sessions.createSession({ flowKind: kind, userId: clients.userId, sessionId: readerSessionId(clients.userId, kind) });
    } catch (error) {
      if (describeFailure(error).httpStatus !== 409) throw error;
      const listed = await clients.sessions.listSessions({ userId: clients.userId });
      if (listed.some((s) => s.parentSessionId == null && s.flowKind === kind)) return;
      await clients.sessions.createSession({ flowKind: kind, userId: clients.userId });
    }
  };

  /** A workstream's attached boards and their rows. */
  const readWorkstreamBoards = async (workstream: Workstream): Promise<Section<WorkstreamBoards>> => {
    try {
      const manifest = await manifestFor(workstream.kind ?? workstream.id, workstream.id);
      const refs = boardRefsFor(workstream.id, manifest);
      const rows = (await Promise.all(refs.map((ref) => readBoard(workstream.id, ref)))).flat();
      return { ok: true, value: { refs, rows } };
    } catch (error) {
      return { ok: false, failure: describeFailure(error) };
    }
  };

  /** The pending person-asks in one session. */
  const readAsks = async (session: SessionSummary, seatId: string | null): Promise<Ask[]> => {
    const pending = (await readPendingSuspensions(clients, session.id)).filter((view) => PERSON_REASONS.has(view.item.reason));
    if (pending.length === 0) return [];
    // Which transport each suspended request arrived on: that decides whether
    // the Lab will reopen it. Read only for a session that holds an ask.
    const sources = new Map(
      (await clients.sessions.listSessionRequests(session.id, { status: "suspended" })).map((request) => [
        request.id,
        request.source,
      ]),
    );
    return pending.map((view) => ({
      sessionId: session.id,
      seatId,
      flowId: session.flowId ?? null,
      parentSessionId: session.parentSessionId ?? null,
      kind: suspensionShape(view.item) === "approval" ? ("approval" as const) : ("question" as const),
      item: view.item,
      since: typeof view.item.ts === "number" ? view.item.ts : session.updatedAt,
      unanswerable:
        session.flowId == null
          ? UNOWNED_SESSION_UNANSWERABLE
          : !REOPENED_SOURCES.has(sources.get(view.item.requestId) ?? "")
            ? DISPATCHED_RUN_UNANSWERABLE
            : null,
    }));
  };

  /**
   * The declared documents a listed session's flow serves to a browser: each
   * flow's manifest, read once (and cached), keeping the single resources whose
   * content a client may read. A document no flow serves, or a flow no listed
   * session runs, is not found: nothing is read but the person's own sessions.
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
      sessions = await clients.sessions.listSessions({ userId: clients.userId, include: "dispatch-runs" });
    } catch (error) {
      return firstFailure(describeFailure(error));
    }
    // Before the organization is read, on purpose, even though a Lab with no
    // reader kind answers it 404 on every refused read: a reading session is
    // the only session a first-visit person can have for the org to be read off.
    const readers = await withReaderSessions(sessions);
    sessions = readers.sessions;
    let orgId: string | undefined;
    try {
      const first = sessions[0];
      const opened = readers.inventory ?? readers.projects;
      if (first === undefined) return opened === null ? { refused: { message: noOrganization(clients.userId) } } : firstFailure(opened);
      orgId = (await clients.sessions.getSession(first.id)).orgId;
    } catch (error) {
      return firstFailure(describeFailure(error));
    }
    if (typeof orgId !== "string" || orgId.length === 0) return { refused: { message: noOrganization(clients.userId, "their session records none") } };

    const [inventory, ownWorkers] = await Promise.all([readInventory(sessions), readOwnWorkers()]);

    const [boardEntries, asks, resources, projects] = await Promise.all([
      inventory.ok
        ? Promise.all(
            inventory.value.workstreams.map(async (w) => [w.id, await readWorkstreamBoards(w)] as const),
          )
        : Promise.resolve([] as Array<readonly [string, Section<WorkstreamBoards>]>),
      (async (): Promise<Section<Ask[]>> => {
        if (!inventory.ok) {
          return { ok: false, failure: { message: `Asks are read from seat sessions, and the seat inventory did not load. ${inventory.failure.message}` } };
        }
        if (!ownWorkers.ok) {
          return { ok: false, failure: { message: `Asks are read from your own workers' sessions too, and your roster did not load. ${ownWorkers.failure.message}` } };
        }
        // A seat's sessions are on its worker flow, and name the worker in
        // their state. One on a seat's flow that names none is still read: its
        // asks are shown, unattributed. A session naming one of the person's
        // own workers, on the flow their roster says it runs on, is that
        // worker's: the listing holds only the person's sessions, so it is
        // their own worker's and nobody else's. Another flow's session that
        // merely names it in its state is not.
        const seatIds = new Set(inventory.value.seats.map((s) => s.id));
        const seatKinds = new Set(inventory.value.seats.map((s) => s.kind).filter((k): k is string => k !== null));
        const seatSessions = sessions.flatMap((s): Array<{ session: SessionSummary; seatId: string | null }> => {
          const workerId = workerOf(s);
          if (workerId !== null && ownWorkers.value.get(workerId) === s.flowKind) return [{ session: s, seatId: workerId }];
          if (!seatKinds.has(s.flowKind)) return [];
          if (workerId === null) return [{ session: s, seatId: null }];
          return seatIds.has(workerId) ? [{ session: s, seatId: workerId }] : [];
        });
        try {
          const found = await inBatches(seatSessions, ASK_READ_BATCH, ({ session, seatId }) => readAsks(session, seatId));
          return { ok: true, value: found.flat().sort((a, b) => a.since - b.since) };
        } catch (error) {
          return { ok: false, failure: describeFailure(error) };
        }
      })(),
      readResources(sessions),
      readProjects(sessions, readers.projects),
    ]);

    return {
      readAt: Date.now(),
      sessions,
      orgId,
      inventory,
      projects,
      boards: Object.fromEntries(boardEntries),
      asks,
      resources,
    };
  };

  const resume: LabReader["resume"] = async (ask, answer) => {
    if (ask.flowId === null) throw new Error(UNOWNED_SESSION_UNANSWERABLE);
    await clients.recovery.resumeSuspension(ask.flowId, ask.item.requestId, {
      suspensionId: ask.item.suspensionId,
      action: answer.action,
      ...(answer.data === undefined ? {} : { data: answer.data }),
      resumedBy: clients.userId,
    });
  };

  return { read, readBoard, resume };
}
