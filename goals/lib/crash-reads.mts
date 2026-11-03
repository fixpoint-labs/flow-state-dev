/**
 * What a crash goal reads back once its host has been crashed and served again
 * (`crashAndRestart` in `server.mts`): the three signals each
 * `survives-a-crash-mid-turn` goal grades, through the public client only.
 *
 * - {@link readConversation}: the session still lists the person's message and
 *   every turn that ended before the crash.
 * - {@link readCutTurn}: `requests.interrupted()` lists the turn that was
 *   running, and it no longer reads as running.
 * - {@link readTaskAfterCrash}: the coding task's row reads a fresh attempt or
 *   an ending with its reason, with no call from the goal in between.
 *
 * Each returns `undefined` when its signal holds, or the sentence a FAIL says.
 * Nothing here writes: the goal's own app does every write.
 */
import type { Client } from "@flow-state-dev/client";
import { sleep } from "./time.mts";

/** A request status that still counts as running. */
const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
/** A task status that has ended. */
const ENDED = new Set(["completed", "errored", "failed", "cancelled"]);

/** One item, as a session's state lists it. */
type Item = { type?: string; role?: string; requestId?: string; content?: unknown };

/** Every item of a session, read a page at a time. */
async function sessionItems(client: Client, sessionId: string): Promise<Item[]> {
  const items: Item[] = [];
  for (let offset = 0; ; ) {
    const page = (await client.sessions.state(sessionId, { includeItems: true, offset, limit: 100 })) as {
      items?: Item[];
      pagination?: { hasMore: boolean; nextOffset: number };
    };
    items.push(...(page.items ?? []));
    if (page.pagination?.hasMore !== true) return items;
    offset = page.pagination.nextOffset;
  }
}

/** An item's text, whatever shape its content takes. */
function textOf(item: Item): string {
  const c = item.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((part) => String((part as { text?: unknown }).text ?? "")).join("\n");
  return "";
}

/**
 * The conversation signal: `sessionId` still lists a user message holding
 * `said`, and every request in `ended` is still in its request list.
 *
 * A read that fails (the session is not found on the store the host serves)
 * is the FAIL, not a throw: that is what a fresh store looks like.
 */
export async function readConversation(client: Client, sessionId: string, said: string, ended: readonly string[]): Promise<string | undefined> {
  let items: Item[];
  let requests: Array<{ id: string }>;
  try {
    items = await sessionItems(client, sessionId);
    requests = (await client.sessions.requests(sessionId, { limit: 100 })) as Array<{ id: string }>;
  } catch (error) {
    return `the conversation ${sessionId} can't be read after the restart: ${error instanceof Error ? error.message : String(error)}`;
  }
  const mine = items.some((item) => item.type === "message" && item.role === "user" && textOf(item).includes(said));
  if (!mine) return `the conversation lists no message of the person's holding "${said}" (${items.length} items)`;
  const listed = new Set(requests.map((r) => r.id));
  const lost = ended.filter((id) => !listed.has(id));
  if (lost.length > 0) return `the conversation no longer lists the turns ${lost.join(", ")}`;
  return undefined;
}

/**
 * The cut-turn signal: within `ms`, `requests.interrupted()` lists
 * `requestId`, and its status does not read as running.
 *
 * Polled, because a host marks a request interrupted once its heartbeat is
 * stale, which is the host's threshold after the crash, not the moment it
 * serves again.
 */
export async function readCutTurn(client: Client, requestId: string, ms: number): Promise<string | undefined> {
  let seen: string[] = [];
  for (const until = Date.now() + ms; Date.now() < until; await sleep(2_000)) {
    let listed;
    try {
      listed = await client.requests.interrupted();
    } catch (error) {
      return `requests.interrupted() failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    seen = listed.map((r) => r.id);
    const cut = listed.find((r) => r.id === requestId);
    if (cut === undefined) continue;
    const status = (await cut.status()).status;
    return RUNNING.has(status) ? `the cut turn ${requestId} is listed as interrupted but reads ${status}` : undefined;
  }
  return `requests.interrupted() never listed the cut turn ${requestId} within ${ms / 1000}s (it listed ${seen.length === 0 ? "nothing" : seen.join(", ")})`;
}

/** A task row, as far as the task signal reads it. */
export type CrashedRow = { status?: string; attempts?: number; error?: unknown } | undefined;

/**
 * The task signal: within `ms`, the row read by `read` is on a later attempt
 * than `attempts`, or has ended with a reason. `read` must only read.
 *
 * @returns `undefined` and the row it last read, or the FAIL sentence.
 */
export async function readTaskAfterCrash(read: () => Promise<CrashedRow>, attempts: number, ms: number): Promise<{ failure?: string; row: CrashedRow }> {
  let row: CrashedRow;
  for (const until = Date.now() + ms; Date.now() < until; await sleep(2_000)) {
    try {
      row = await read();
    } catch (error) {
      return { failure: `the task can't be read after the restart: ${error instanceof Error ? error.message : String(error)}`, row };
    }
    if (row === undefined) return { failure: "the task is gone after the restart", row };
    if ((row.attempts ?? 0) > attempts) return { row };
    if (row.status !== undefined && ENDED.has(row.status)) {
      const reason = typeof row.error === "string" ? row.error : row.error == null ? "" : JSON.stringify(row.error);
      return reason.trim() === "" ? { failure: `the task ended ${row.status} with no reason`, row } : { row };
    }
  }
  return {
    failure: `the task still reads ${row?.status} on attempt ${row?.attempts} ${ms / 1000}s after the restart, its claim dead`,
    row,
  };
}
