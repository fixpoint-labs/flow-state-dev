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
import type { LabClients } from "./connection";
import { describeFailure } from "./reads";

/** One line of a room, as `read` returns it. */
export type RoomLine = { projectId: string; seq: number; userId: string; author: string | null; body: string; tombstone?: boolean };

/** One page of a room: its lines after the cursor, and the cursor to read after next. */
export type RoomPage = { lines: RoomLine[]; nextCursor: number; charter: string; seats: string[] };

/** A talk action that the Lab refused, with its reason. */
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
  let started: Awaited<ReturnType<typeof actions.sendAction>>;
  try {
    started = await actions.sendAction(action, input, sessionId === undefined ? {} : { sessionId });
  } catch (error) {
    throw new TalkRefused(describeFailure(error).message);
  }
  const requestId = started.request.id;
  const session = started.session?.id ?? sessionId;
  if (session === undefined) throw new Error(`the Lab started ${action} in no session`);

  const until = Date.now() + TIMEOUT_MS;
  let status: Awaited<ReturnType<typeof actions.getRequestStatus>>["status"];
  for (;;) {
    status = (await actions.getRequestStatus(requestId)).status;
    if (status !== "in_progress") break;
    if (Date.now() > until) throw new Error(`The Lab did not finish ${action} in time.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  if (status !== "completed" && status !== "failed") throw new TalkRefused(`${action} ended ${status}.`);

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

/** Post a line into the room as the person, through their talk session. */
export async function postToRoom(clients: LabClients, kind: string, sessionId: string, body: string): Promise<void> {
  await runTalkAction(clients, kind, sessionId, "post", { body });
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

/**
 * Wait until the talk session has nothing in flight: the wake a post hands
 * off, and each seat's answer back into the room. Bounded; a wake that is
 * still running when it runs out is simply read on the next focus.
 */
export async function settled(clients: LabClients, sessionId: string, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  // The hand-off starts just after the post's own request ends, and a seat's
  // answer just after the hand-off reaches it: two quiet reads in a row, not
  // one, before the wake counts as done.
  let quiet = 0;
  while (Date.now() < until && quiet < 2) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const running = await clients.sessions.listSessionRequests(sessionId, { status: "in_progress" });
    quiet = running.length === 0 ? quiet + 1 : 0;
  }
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
