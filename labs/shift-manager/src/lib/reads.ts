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
 *    session records it. A person who holds no session on the room kind yet
 *    has one opened first (`withRoomSession`), and the Lab stamps it with the
 *    organization it resolves for them, so a member on a first visit is read
 *    like any other. A Lab that still lists the person no session (it serves
 *    no room kind) names no organization, and gets the refusal too: Shift
 *    Manager never draws a Lab under an unknown one (ER-4).
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
 *    pending. Not the transcript.
 * 6. **Declared documents** a browser may read, from each listed flow's
 *    manifest, for Jump to (BR-10).
 * 7. **The organization's projects**: every row of its `projects` collection,
 *    found by its published key pattern on a workstream's mailbox kind.
 *    PROJECTS groups the workstreams by them. A project's room is never read
 *    here: it is read through the person's own talk session when a project's
 *    Stream opens (`talk.ts`).
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
import { ClientHttpError, type ResourceManifest, type SessionSummary } from "@flow-state-dev/client";
import type { OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import type { ResumeAction } from "@flow-state-dev/core/types";
import { deriveSuspensions, suspensionShape } from "@flow-state-dev/react";
import {
  HIRED_ROSTER_BROWSER_PATTERN,
  isHiredSeatRow,
  listedSeatRows,
  splitSeatAddress
} from "@flow-state-dev/workforce/browser";
import type { LabClients } from "./connection";

/** Why a read did not load. */
export type Failure = { message: string; httpStatus?: number };

/** One section's outcome: its value, or why it has none. */
export type Section<T> = { ok: true; value: T } | { ok: false; failure: Failure };

/** A seat, as the seat inventory registers it. */
export type Seat = {
  /**
   * The seat's address, which is also its flow instance id: `<team>.<name>`,
   * a bare name for an org seat, or `<org>.<seatId>` for a hired one.
   */
  id: string;
  /** The kind the seat was hired from; `null` on a row that has none. */
  kind: string | null;
  /**
   * The action that takes a person's message into this seat's sessions, as
   * the hire published it; `null` when its kind takes none, or on a row
   * written before doors were published.
   */
  door: string | null;
  /**
   * Whether the row says the seat was hired at runtime (`true`) or declared
   * (`false`); `null` on a row written before rows said, which is then read
   * by its id's shape.
   */
  hired: boolean | null;
  /**
   * The id boards and mailboxes name the seat by: for a hired seat the
   * `<seatId>` inside its `<org>.<seatId>` address, otherwise `id` itself.
   */
  seatId: string;
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

/** One member's talk session on a project: their own way into its room. */
export type ProjectSession = { sessionId: string; userId: string };

/**
 * A project: a row of the organization's `projects` collection. It names no
 * team; its workstreams are mailbox ids from any team.
 */
export type Project = {
  /** The row id, also the project's address in Shift Manager. */
  id: string;
  title: string;
  /** What the project is for; its Brief tab. `null` when none was given. */
  brief: string | null;
  status: string;
  ownerUserId: string;
  /** Who may read and post the project's room. */
  members: string[];
  /** The mailbox ids the project holds, as the row lists them. */
  workstreams: string[];
  /** Each member's talk session, at most one per person. */
  sessions: ProjectSession[];
};

/** The organization's projects. */
export type Projects = {
  /** Every row, in the collection's order. */
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
 * the room kind, is refused: nothing it serves says which organization they are in.
 */
function noOrganization(userId: string, why = "it holds no session of theirs and serves no mailbox kind to open one on"): string {
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
  /**
   * The seats a team list shows: a hired seat only while the organization's
   * roster backs it (Workforce's `listedSeatRows`), every declared seat as registered.
   */
  seats: Seat[];
  workstreams: Workstream[];
  /**
   * Set when hired seats were left out because the roster couldn't be read:
   * says how many and why. Absent when the roster loaded, or nothing was left out.
   */
  rosterUnread?: string;
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
 * The flow kind every project's room is on: workforce's built-in mailbox kind
 * (`MAILBOX_KIND`), whichever kind a workstream runs on or the projects were
 * read through. Spelled here because the workforce browser entry doesn't
 * export it; `static.test.ts` pins the two together.
 */
export const ROOM_KIND = "mailbox";

/**
 * The organization's projects, by their published key pattern.
 */
const PROJECT_PATTERNS = { projects: "projects/*" } as const;

/** The organization's hired roster, by its published key pattern. */
const ROSTER_PATTERN = HIRED_ROSTER_BROWSER_PATTERN;

/** Rows per collection page: the collection route's maximum. */
const PAGE_SIZE = 200;
/** A guard against a server that pages forever; the shipped panel readers use the same bound. */
const MAX_PAGES = 1000;
/** Suspension items per session-state page. */
const ASK_PAGE_SIZE = 200;
/** How many seat sessions are read at once. */
const ASK_READ_BATCH = 6;

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
 * A seat inventory row, grouped by its address (FIX-1719's seat contract):
 *
 * - `<org>.<seatId>`, a seat hired at runtime into this organization (a
 *   user-owned one too), is split the way Workforce splits it and grouped by
 *   the seat id it holds;
 * - `<team>.<name>` sits under its team: a team id carries no dot, so the team
 *   is everything before the first one;
 * - an id with no dot is an org seat, and sits in {@link STAFF_TEAM}.
 *
 * Which of the first two a row is comes from the row's own `hired` field, so
 * a declared team that shares the organization's name stays a team. A row
 * written before the field existed is read by its id's shape.
 */
export function toSeat(row: unknown, orgId: string): Seat | undefined {
  const id = text(field(row, "id"));
  if (id === null) return undefined;
  const flag = field(row, "hired");
  const hired = typeof flag === "boolean" ? flag : null;
  const address = (isHiredSeatRow(orgId, { id, hired }) ? splitSeatAddress(orgId, id) : undefined) ?? id;
  const dot = address.indexOf(".");
  const team = dot > 0 ? address.slice(0, dot) : STAFF_TEAM;
  const name = dot > 0 ? address.slice(dot + 1) : address;
  return { id, kind: text(field(row, "kind")), door: text(field(row, "door")), hired, seatId: address, team, name };
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
export function toProject(row: unknown): Project | undefined {
  const id = text(field(row, "id"));
  const title = text(field(row, "title"));
  const ownerUserId = text(field(row, "ownerUserId"));
  if (id === null || title === null || ownerUserId === null) return undefined;
  const sessions = field(row, "sessions");
  return {
    id,
    title,
    // An empty brief is still the brief the row was given; only a missing or non-string one is none.
    brief: typeof field(row, "brief") === "string" ? (field(row, "brief") as string) : null,
    status: text(field(row, "status")) ?? "active",
    ownerUserId,
    members: strings(field(row, "members")),
    workstreams: strings(field(row, "workstreams")),
    sessions: Array.isArray(sessions)
      ? sessions.flatMap((link) => {
          const sessionId = text(field(link, "sessionId"));
          const userId = text(field(link, "userId"));
          return sessionId === null || userId === null ? [] : [{ sessionId, userId }];
        })
      : [],
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

/** Build the reader for one connection. */
/**
 * The id of `userId`'s own session on the room kind: one per person, so two
 * first visits at once (two tabs) open the same session rather than two.
 */
export function roomSessionId(userId: string): string {
  return `${ROOM_KIND}-own-${userId}`;
}

/**
 * Room-session opens in flight, per client, so reads that overlap on one page
 * (StrictMode replaying the boot) share one open rather than racing it.
 */
const openingRoom = new WeakMap<LabClients, Promise<void>>();

export function createLabReader(clients: LabClients): LabReader {
  const manifests = new Map<string, Promise<ResourceManifest>>();

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
  const readCollection = async (sessionId: string, ref: string) => {
    const rows: Array<{ topic: string; clientData?: unknown }> = [];
    let cursor: string | undefined;
    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES) throw new Error(`the Lab kept returning pages of ${ref}, so the read stopped`);
      const result = await clients.resources.listCollectionItems(sessionId, ref, {
        limit: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      rows.push(...result.items);
      if (result.nextCursor === undefined || result.nextCursor === cursor) break;
      cursor = result.nextCursor;
    }
    return rows;
  };

  const readBoard = async (mailboxId: string, boardRef: string): Promise<BoardRow[]> =>
    (await readCollection(mailboxId, boardRef)).map((row) => toBoardRow(boardRef, mailboxId, row.topic, row.clientData));

  /**
   * The organization's hired roster (its seat ids), through the first listed
   * flow that declares it. A failure, or no listed flow declaring it, is the
   * section's failure: the caller then lists no hired seat.
   */
  const readRoster = async (
    byKind: ReadonlyMap<string, string>,
  ): Promise<Section<Array<{ seatId: string; incarnation: string | null }>>> => {
    try {
      for (const [kind, sessionId] of byKind) {
        const manifest = await manifestFor(kind, sessionId);
        const ref = manifest.resources.find(
          (r) => r.kind === "collection" && r.pattern === ROSTER_PATTERN && r.client.state?.read === true,
        )?.ref;
        if (ref === undefined) continue;
        const rows = await readCollection(sessionId, ref);
        return {
          ok: true,
          value: rows.flatMap((row) => {
            const seatId = text(field(row.clientData, "seatId"));
            return seatId === null ? [] : [{ seatId, incarnation: text(field(row.clientData, "incarnation")) }];
          }),
        };
      }
    } catch (error) {
      return { ok: false, failure: describeFailure(error) };
    }
    return { ok: false, failure: { message: "None of this person's sessions is on a flow that declares the roster." } };
  };

  /**
   * The sessions the roster may be read through: the top-level ones by kind
   * first, then a kind seen only on a dispatch child. The roster is org-scoped,
   * so any session of the org reads the same rows, and a viewer whose only
   * session on a roster-declaring flow is a child still has one.
   */
  const rosterCarriers = (sessions: SessionSummary[], topLevel: ReadonlyMap<string, string>) => {
    const byKind = new Map(topLevel);
    for (const session of sessions) {
      if (!byKind.has(session.flowKind)) byKind.set(session.flowKind, session.id);
    }
    return byKind;
  };

  /** Find the inventory through the first listed session whose flow declares it. */
  const readInventory = async (sessions: SessionSummary[], orgId: string): Promise<Section<Inventory>> => {
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
        // Each seat beside the incarnation its row carries, which the
        // team-list rule matches against the roster row's.
        const rows = seatRows.flatMap((r) => {
          const seat = toSeat(r.clientData, orgId);
          return seat === undefined
            ? []
            : [{ id: seat.id, hired: seat.hired, incarnation: text(field(r.clientData, "incarnation")), seat }];
        });
        const registered = rows.map((row) => row.seat);
        // A hired seat is listed only while the roster backs it: Workforce's
        // team-list rule, applied once here so every screen draws the same list.
        // The roster is read only when a hired seat's row is there to check.
        const anyHired = registered.some((seat) => isHiredSeatRow(orgId, seat));
        const roster = anyHired ? await readRoster(rosterCarriers(sessions, byKind)) : ({ ok: true, value: [] } as const);
        const seats = listedSeatRows(orgId, rows, roster.ok ? roster.value : undefined).map((row) => row.seat);
        const hiddenForNoRoster = registered.length - seats.length;
        const rosterUnread =
          roster.ok || hiddenForNoRoster === 0
            ? null
            : `${hiddenForNoRoster} hired seat${hiddenForNoRoster === 1 ? " isn't" : "s aren't"} listed: the roster didn't load, so Shift Manager can't show ${hiddenForNoRoster === 1 ? "it's" : "they're"} still hired. ${roster.failure.message}`;
        const workstreams = mailboxRows
          .map((r) => toWorkstream(r.clientData))
          .filter((w): w is Workstream => w !== undefined);
        // Empty means nothing registered, not nothing listed: hired seats the
        // roster can't vouch for are a listed inventory with `rosterUnread`.
        if (registered.length === 0 && workstreams.length === 0) {
          return {
            ok: false,
            failure: {
              message:
                "The Lab's inventory is empty: it registers no seats and no mailboxes. The Lab booted without opening its inventory.",
            },
          };
        }
        return { ok: true, value: { seats, workstreams, ...(rosterUnread === null ? {} : { rosterUnread }) } };
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
   * The organization's projects, read once, through a session of this
   * person's own whose flow declares the projects collection with a browser
   * read. A project needs no workstream, so neither does this read. That
   * session only carries the read; rooms are on the built-in mailbox kind
   * (`ROOM_KIND`).
   *
   * `read` opens one on the room kind for a person who holds none
   * (`withRoomSession`). No flow declaring the collection is a Lab with no
   * projects: zero rows, not a failure (a pre-project Lab, or one that serves
   * no room kind). A room session that should have been opened and couldn't
   * is a failure, and says why; it is never drawn as an empty list (D3).
   */
  const readProjects = async (sessions: SessionSummary[], roomFailure: Failure | null): Promise<Section<Projects>> => {
    const projectsRef = (manifest: ResourceManifest) =>
      manifest.resources.find(
        (r) => r.kind === "collection" && r.pattern === PROJECT_PATTERNS.projects && r.client.state?.read === true,
      )?.ref;
    const carriers = new Map<string, string>();
    for (const session of sessions) {
      if (session.parentSessionId == null && !carriers.has(session.flowKind)) carriers.set(session.flowKind, session.id);
    }
    try {
      let found: { sessionId: string; ref: string } | undefined;
      for (const [kind, sessionId] of carriers) {
        const ref = projectsRef(await manifestFor(kind, sessionId));
        if (ref !== undefined) {
          found = { sessionId, ref };
          break;
        }
      }
      if (found === undefined) {
        if (roomFailure === null) return { ok: true, value: { rows: [] } };
        return {
          ok: false,
          failure: {
            ...roomFailure,
            message: `None of your sessions can read this Lab's projects, and one that can couldn't be opened: ${roomFailure.message}`,
          },
        };
      }
      // Invariant: `projects/*` is one org-wide collection, so the first kind
      // that declares it reads every project, and the rest are not asked.
      const rows = (await readCollection(found.sessionId, found.ref))
        .map((row) => toProject(row.clientData))
        .filter((p): p is Project => p !== undefined);
      return { ok: true, value: { rows } };
    } catch (error) {
      return { ok: false, failure: describeFailure(error) };
    }
  };

  /**
   * This person's sessions, with one of their own on the room kind. A member
   * who hasn't joined a room yet may hold only a seat's session, or none at
   * all on a first visit, and nothing of theirs can read the organization's
   * inventory or projects; a session on
   * the room kind can, since that kind declares both. It is opened once, under
   * {@link roomSessionId} so overlapping first reads can't open two, and
   * listed from then on. If it can't be opened, the sessions are returned as
   * they were, with why: `null` when there is nothing to open (the Lab serves
   * no room kind, a 404), so nothing declares what it would have read.
   */
  const withRoomSession = async (
    sessions: SessionSummary[],
  ): Promise<{ sessions: SessionSummary[]; failure: Failure | null }> => {
    if (sessions.some((s) => s.parentSessionId == null && s.flowKind === ROOM_KIND)) return { sessions, failure: null };
    try {
      let opening = openingRoom.get(clients);
      if (opening === undefined) {
        opening = openRoomSession().finally(() => openingRoom.delete(clients));
        openingRoom.set(clients, opening);
      }
      await opening;
      return { sessions: await clients.sessions.listSessions({ userId: clients.userId, include: "dispatch-runs" }), failure: null };
    } catch (error) {
      const failure = describeFailure(error);
      return { sessions, failure: failure.httpStatus === 404 ? null : failure };
    }
  };

  /**
   * Open the person's room session under its one id. A 409 is usually another
   * page that opened it first, and the listing then holds it. Session ids are
   * not scoped by organization, so a 409 the listing doesn't explain is that id
   * held in another of the person's organizations: open one under a fresh id.
   */
  const openRoomSession = async (): Promise<void> => {
    try {
      await clients.sessions.createSession({ flowKind: ROOM_KIND, userId: clients.userId, sessionId: roomSessionId(clients.userId) });
    } catch (error) {
      if (describeFailure(error).httpStatus !== 409) throw error;
      const listed = await clients.sessions.listSessions({ userId: clients.userId });
      if (listed.some((s) => s.parentSessionId == null && s.flowKind === ROOM_KIND)) return;
      await clients.sessions.createSession({ flowKind: ROOM_KIND, userId: clients.userId });
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
    // room kind answers it 404 on every refused read: the room session is the
    // only session a first-visit person can have for the org to be read off.
    const room = await withRoomSession(sessions);
    sessions = room.sessions;
    let orgId: string | undefined;
    try {
      const first = sessions[0];
      if (first === undefined) return room.failure === null ? { refused: { message: noOrganization(clients.userId) } } : firstFailure(room.failure);
      orgId = (await clients.sessions.getSession(first.id)).orgId;
    } catch (error) {
      return firstFailure(describeFailure(error));
    }
    if (typeof orgId !== "string" || orgId.length === 0) return { refused: { message: noOrganization(clients.userId, "their session records none") } };

    const inventory = await readInventory(sessions, orgId);

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
        const seatIds = new Set(inventory.value.seats.map((s) => s.id));
        const seatKinds = new Set(inventory.value.seats.map((s) => s.kind).filter((k): k is string => k !== null));
        const seatSessions = sessions.flatMap((s): Array<{ session: SessionSummary; seatId: string | null }> =>
          s.flowId != null
            ? seatIds.has(s.flowId)
              ? [{ session: s, seatId: s.flowId }]
              : []
            : seatKinds.has(s.flowKind)
              ? [{ session: s, seatId: null }]
              : [],
        );
        try {
          const found = await inBatches(seatSessions, ASK_READ_BATCH, ({ session, seatId }) => readAsks(session, seatId));
          return { ok: true, value: found.flat().sort((a, b) => a.since - b.since) };
        } catch (error) {
          return { ok: false, failure: describeFailure(error) };
        }
      })(),
      readResources(sessions),
      readProjects(sessions, room.failure),
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
