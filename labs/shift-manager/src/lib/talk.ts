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
  const session = sessionId ?? `talk-${crypto.randomUUID()}`;
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

  for (let page = 0; page < REQUEST_PAGES; page += 1) {
    const listed = await clients.sessions.listSessionRequests(session, {
      status,
      includeResultOutput: true,
      limit: REQUEST_PAGE,
      offset: page * REQUEST_PAGE,
    });
    const found = listed.find((request) => request.id === requestId);
    if (found !== undefined) {
      if (status === "failed") throw new TalkRefused(found.result?.error?.message ?? `${action} was refused.`);
      return { output: found.result?.output, sessionId: session };
    }
    if (listed.length < REQUEST_PAGE) break;
  }
  if (status === "failed") throw new TalkRefused(`${action} was refused.`);
  throw new Error(`The Lab finished ${action} but its answer is not in the session's requests.`);
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
 * Read every page of a room after `after`, handing each page to `onPage` as
 * it arrives, until the cursor stops advancing.
 *
 * @returns the cursor to read after next.
 */
export async function readRoomPages(page: (after: number) => Promise<RoomPage>, after: number, onPage: (page: RoomPage) => void): Promise<number> {
  let cursor = after;
  for (;;) {
    const read = await page(cursor);
    onPage(read);
    // A page can be empty and still move the cursor: every line on it was a
    // tombstone. Only a cursor that stops moving ends the read.
    if (read.nextCursor <= cursor) return cursor;
    cursor = read.nextCursor;
  }
}

/** Post a line into the room as the person, through their talk session. */
export async function postToRoom(clients: LabClients, kind: string, sessionId: string, body: string): Promise<RoomLine> {
  const { output } = await runTalkAction(clients, kind, sessionId, "post", { body });
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
};

/**
 * The one refresh loop of an open room view. It reads the room's new lines
 * (`read` returns how many it found) from the view's cursor, sooner while
 * lines are arriving and backing off to `maxMs` while the room is quiet.
 * `wake` reads at once and starts the wait over, which is what a post does:
 * the seats it woke answer into the room, and the next reads pick them up.
 * Nothing here waits on a particular seat or ties a line to the post before it.
 *
 * There is only ever one read in flight and one timer pending, however often
 * it is woken. `stop` ends it, and nothing reads after that. A read that
 * fails counts as a quiet one; the view shows the failure.
 */
export function startRoomRefresh(read: () => Promise<number>, options: RoomRefreshOptions = {}): { wake(): void; stop(): void } {
  const minMs = options.minMs ?? 1_000;
  const maxMs = options.maxMs ?? 15_000;
  const visible = options.visible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  let delay = minMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let reading = false;
  let wokenWhileReading = false;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void tick(), ms);
  };
  const tick = async () => {
    if (stopped) return;
    if (reading) {
      wokenWhileReading = true;
      return;
    }
    if (!visible()) {
      schedule(maxMs);
      return;
    }
    reading = true;
    let fresh = 0;
    try {
      fresh = await read();
    } catch {
      fresh = 0;
    }
    reading = false;
    if (stopped) return;
    delay = wokenWhileReading || fresh > 0 ? minMs : Math.min(delay * 2, maxMs);
    schedule(wokenWhileReading ? 0 : delay);
    wokenWhileReading = false;
  };

  schedule(delay);
  return {
    wake() {
      if (stopped) return;
      delay = minMs;
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
