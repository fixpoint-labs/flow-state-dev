/**
 * A project's room, read and posted through the person's own talk session.
 *
 * Shift Manager reaches a project's conversation only through here and
 * `talkFor` (`derive.ts`): the room's lines are org data a browser can't read
 * directly, so every read and post is a request on the person's talk session,
 * which checks the project row's members before it touches the room. Nothing
 * here reads another person's session, and nothing is drawn that the room
 * didn't return.
 *
 * Each entry is an action on the talk session's flow: `read { after }` for a
 * page of the room after a cursor, `post` for a line, and `join` for a member
 * with no talk session yet (and an owner the mint at create missed). The
 * action's answer is read back from the session's request list once the
 * request ends; a refused request rejects with the Lab's own reason.
 *
 * Lines map onto the transcript line a workstream's Stream draws, so the
 * project's Stream reuses that component.
 */
import type { ChannelTranscriptLine } from "@flow-state-dev/workforce/browser";
import { ClientHttpError } from "@flow-state-dev/client";
import type { LabClients } from "./connection";
import { newSessionId } from "./ids";
import { describeFailure } from "./reads";

export { ROOM_KIND } from "./reads";

/** One line of a room, as `read` returns it. */
export type RoomLine = { projectId: string; seq: number; userId: string; author: string | null; body: string; tombstone?: boolean };

/** One page of a room: its lines after the cursor, and the cursor to read after next. */
export type RoomPage = { lines: RoomLine[]; nextCursor: number; charter: string; seats: string[] };

/**
 * A talk action the Lab answered with a refusal and its reason: a request
 * that ended failed, or a 4xx naming why. Anything else (the Lab out of
 * reach, a 5xx) is thrown as it came, and is something to retry.
 */
export class TalkRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TalkRefused";
  }
}

const POLL_MS = 150;
const TIMEOUT_MS = 30_000;
/** Requests listed per page while looking for the one that just ended. */
const REQUEST_PAGE = 100;
const REQUEST_PAGES = 20;

/**
 * Run one action on a talk session (or, with no session, on a new one the
 * Lab creates for this person) and return what it answered, with the session
 * it ran in.
 */
async function runTalkAction(
  clients: LabClients,
  kind: string,
  sessionId: string | undefined,
  action: string,
  input: unknown,
): Promise<{ output: unknown; sessionId: string }> {
  const actions = clients.actions(kind);
  // A new session is named here: the Lab's answer to an action started with
  // no session names none, and its requests are read back by session.
  const session = sessionId ?? newSessionId("talk");
  let started: Awaited<ReturnType<typeof actions.sendAction>>;
  try {
    started = await actions.sendAction(action, input, { sessionId: session });
  } catch (error) {
    // The Lab said no, with a reason. A 5xx or no answer at all is not a refusal.
    if (error instanceof ClientHttpError && error.status >= 400 && error.status < 500) {
      throw new TalkRefused(describeFailure(error).message);
    }
    throw error;
  }
  const requestId = started.request.id;

  const until = Date.now() + TIMEOUT_MS;
  let status: Awaited<ReturnType<typeof actions.getRequestStatus>>["status"];
  for (;;) {
    status = (await actions.getRequestStatus(requestId)).status;
    if (status !== "in_progress") break;
    if (Date.now() > until) throw new Error(`The Lab did not finish ${action} in time.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  // Ended without the Lab's answer (aborted, interrupted, incomplete): not a refusal, so the view offers Retry.
  if (status !== "completed" && status !== "failed") throw new Error(`The Lab's ${action} ended ${status} before it answered.`);

  const findAnswer = async () => {
    for (let page = 0; page < REQUEST_PAGES; page += 1) {
      const listed = await clients.sessions.listSessionRequests(session, {
        status,
        includeResultOutput: true,
        limit: REQUEST_PAGE,
        offset: page * REQUEST_PAGE,
      });
      const found = listed.find((request) => request.id === requestId);
      if (found !== undefined || listed.length < REQUEST_PAGE) return found;
    }
    return undefined;
  };
  let found: Awaited<ReturnType<typeof findAnswer>>;
  try {
    found = await findAnswer();
  } catch (error) {
    // The action is done; only reading its answer failed.
    if (status === "completed") throw new TalkAnswerUnread(action, error);
    throw error;
  }
  if (status === "failed") throw new TalkRefused(found?.result?.error?.message ?? `${action} was refused.`);
  if (found === undefined) throw new TalkAnswerUnread(action, new Error("its answer is not in the session's requests"));
  return { output: found.result?.output, sessionId: session };
}

/**
 * A talk action the Lab completed whose answer couldn't be read back. What it
 * did stands: a post is in the room.
 */
export class TalkAnswerUnread extends Error {
  constructor(action: string, cause: unknown) {
    super(`The Lab finished ${action}, but its answer could not be read: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "TalkAnswerUnread";
  }
}

/** Read one page of the room after `after`, through the person's talk session. */
export async function readRoom(clients: LabClients, kind: string, sessionId: string, after: number): Promise<RoomPage> {
  const { output } = await runTalkAction(clients, kind, sessionId, "read", { after });
  const page = output as Partial<RoomPage> | undefined;
  if (page === undefined || !Array.isArray(page.lines) || typeof page.nextCursor !== "number") {
    throw new Error("The talk session answered `read` with no page of the room.");
  }
  return {
    lines: page.lines.filter((line) => line.tombstone !== true),
    nextCursor: page.nextCursor,
    charter: typeof page.charter === "string" ? page.charter : "",
    seats: Array.isArray(page.seats) ? page.seats : [],
  };
}

/**
 * Read the pages of a room after `after`, handing each page to `onPage` as it
 * arrives, until the cursor stops advancing or `maxPages` pages are read. A
 * room further behind than that is caught up by the next call, from the
 * cursor this one returns.
 *
 * @returns the cursor to read after next.
 */
export async function readRoomPages(
  page: (after: number) => Promise<RoomPage>,
  after: number,
  onPage: (page: RoomPage) => void,
  maxPages = Number.POSITIVE_INFINITY,
): Promise<number> {
  let cursor = after;
  for (let pages = 0; pages < maxPages; pages += 1) {
    const read = await page(cursor);
    onPage(read);
    // A page can be empty and still move the cursor: every line on it was a
    // tombstone. Only a cursor that stops moving ends the read.
    if (read.nextCursor <= cursor) return cursor;
    cursor = read.nextCursor;
  }
  return cursor;
}

/** The most lines one `read` returns: workforce's `ROOM_PAGE_SIZE` (pinned in `static.test.ts`). */
export const ROOM_PAGE = 200;
/** The most pages a read for earlier lines steps back over when every line on them was removed. */
const MAX_PAGES_BACK = 5;
/** A guard on finding the end: 64 reads covers any room a sequence number can count. */
const MAX_END_READS = 64;

/**
 * The room's last committed sequence number, in reads that grow with the log
 * of its length. `read { after }` can't start from the end, but its cursor
 * says where the room stops: the next cursor is `min(end, after + ROOM_PAGE)`
 * when the room goes past `after`, and `after` when it doesn't. So probes
 * double ahead until one lands past the end, then halve the gap.
 */
export async function findRoomEnd(page: (after: number) => Promise<RoomPage>): Promise<number> {
  let lo = 0; // the end is at least this
  let hi: number | undefined; // and at most this, once a probe has passed it
  let ahead = 0;
  for (let reads = 0; reads < MAX_END_READS; reads += 1) {
    if (hi !== undefined && lo >= hi) return lo;
    const at = hi === undefined ? lo + ahead : hi - lo <= ROOM_PAGE ? lo : lo + Math.floor((hi - lo) / 2);
    const { nextCursor } = await page(at);
    if (nextCursor <= at) hi = at;
    else if (nextCursor < at + ROOM_PAGE) return nextCursor;
    else {
      lo = nextCursor;
      ahead = Math.max(ROOM_PAGE, ahead * 2);
    }
  }
  throw new Error("The room's end was not found: its cursor kept moving.");
}

/**
 * The lines just before `floor`, oldest first, and the new floor. Pages that
 * hold only removed lines are stepped over, at most {@link MAX_PAGES_BACK} of
 * them; a floor of 0 is the room's start.
 */
export async function readRoomEarlier(
  page: (after: number) => Promise<RoomPage>,
  floor: number,
): Promise<{ lines: RoomLine[]; floor: number }> {
  let at = floor;
  for (let pages = 0; pages < MAX_PAGES_BACK && at > 0; pages += 1) {
    const before = at;
    at = Math.max(0, before - ROOM_PAGE);
    const lines = (await page(at)).lines.filter((line) => line.seq <= before);
    if (lines.length > 0) return { lines, floor: at };
  }
  return { lines: [], floor: at };
}

/**
 * Open a room at its end: the newest page of lines, the floor below them (0
 * once the room's start is shown), and the cursor to read new lines after.
 */
export async function readRoomTail(
  page: (after: number) => Promise<RoomPage>,
): Promise<{ lines: RoomLine[]; floor: number; cursor: number }> {
  const cursor = await findRoomEnd(page);
  return { ...(await readRoomEarlier(page, cursor)), cursor };
}

/**
 * Post a line into the room as the person, through their talk session.
 *
 * @returns the line, or `undefined` when the Lab completed the post but its
 * answer couldn't be read back: the line is in the room all the same, so it
 * must not be offered again as unsent. The room's next read shows it.
 */
export async function postToRoom(clients: LabClients, kind: string, sessionId: string, body: string): Promise<RoomLine | undefined> {
  let output: unknown;
  try {
    ({ output } = await runTalkAction(clients, kind, sessionId, "post", { body }));
  } catch (error) {
    if (error instanceof TalkAnswerUnread) return undefined;
    throw error;
  }
  const line = output as Partial<RoomLine> | undefined;
  if (typeof line?.seq !== "number") throw new Error("The talk session answered `post` with no line.");
  return line as RoomLine;
}

/**
 * Join a project's room: the person's one talk session on it. The Lab hands
 * back the session the project already lists for them, or binds a new one.
 * A person who is not a member is refused, and nothing is written.
 */
export async function joinRoom(clients: LabClients, kind: string, projectId: string): Promise<string> {
  const { output } = await runTalkAction(clients, kind, undefined, "join", { projectId });
  const sessionId = (output as { sessionId?: unknown } | undefined)?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("`join` answered with no talk session.");
  return sessionId;
}

/** How an open room view keeps reading. */
export type RoomRefreshOptions = {
  /** The wait after a read that found new lines, or after a wake. Default 1 s. */
  minMs?: number;
  /** The longest wait while the room is quiet. Default 15 s. */
  maxMs?: number;
  /** Whether the view is on screen; a hidden view doesn't read. Default: the document is visible. */
  visible?: () => boolean;
  /** Quiet reads in a row after which the loop rests until woken. Default 6 (about 45 s at the defaults). */
  quietReads?: number;
  /** The most reads one arming makes, however busy the room. Default 60. */
  burstReads?: number;
};

/**
 * The one refresh loop of an open room view. Every read is a recorded request
 * on the person's talk session, so the room is read on open, on a wake, and
 * for a bounded burst after each, never on an open-ended timer (DECISIONS Q3).
 * The view wakes it on focus, on coming back to the tab, and after a post.
 *
 * Within a burst it reads the room's new lines (`read` returns how many it
 * found) from the view's cursor, sooner while lines are arriving and backing
 * off to `maxMs` while the room is quiet. After `quietReads` quiet reads in a
 * row, or `burstReads` reads in all, or once the view is hidden, it rests:
 * no timer, no read, until `wake`. A post's wake is what picks up the seats'
 * answers. Nothing here waits on a particular seat or ties a line to the post
 * before it.
 *
 * There is only ever one read in flight and one timer pending, however often
 * it is woken. `stop` ends it, and nothing reads after that. A read that
 * fails counts as a quiet one; the view shows the failure.
 */
export function startRoomRefresh(read: () => Promise<number>, options: RoomRefreshOptions = {}): { wake(): void; stop(): void } {
  const minMs = options.minMs ?? 1_000;
  const maxMs = options.maxMs ?? 15_000;
  const quietReads = options.quietReads ?? 6;
  const burstReads = options.burstReads ?? 60;
  const visible = options.visible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  let delay = minMs;
  let quiet = 0;
  let reads = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let reading = false;
  let wokenWhileReading = false;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void tick(), ms);
  };
  const rest = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const arm = () => {
    delay = minMs;
    quiet = 0;
    reads = 0;
  };
  const tick = async () => {
    if (stopped) return;
    if (reading) {
      wokenWhileReading = true;
      return;
    }
    // Hidden: rest. Coming back to the tab wakes it.
    if (!visible()) return rest();
    reading = true;
    reads += 1;
    let fresh = 0;
    try {
      fresh = await read();
    } catch {
      fresh = 0;
    }
    reading = false;
    if (stopped) return;
    if (wokenWhileReading) {
      wokenWhileReading = false;
      arm();
      return schedule(0);
    }
    quiet = fresh > 0 ? 0 : quiet + 1;
    if (quiet >= quietReads || reads >= burstReads) return rest();
    delay = fresh > 0 ? minMs : Math.min(delay * 2, maxMs);
    schedule(delay);
  };

  schedule(delay);
  return {
    wake() {
      if (stopped) return;
      arm();
      schedule(0);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * A room line as a transcript line: `principal` the person whose line it is,
 * `author` the seat that answered. A room line records no time; `at` is its
 * sequence number, which orders it the same way.
 */
export function asTranscriptLine(line: RoomLine): ChannelTranscriptLine {
  return {
    id: `${line.projectId}/${line.seq}`,
    at: line.seq,
    principal: line.userId,
    ...(line.author === null ? {} : { author: line.author }),
    authorVerified: false,
    body: line.body,
  } as ChannelTranscriptLine;
}
