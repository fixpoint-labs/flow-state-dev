/**
 * Whether a session's history has folded, read the way a screen reads it:
 * the session's `historySummary` resource (its public `clientData`), and the
 * `historyStart` mark its latest request carries. Shared by the goals that
 * need a fold to have happened before they grade what came after it.
 */

/** The summary's public face: whether it is complete, how many folds ran, and the request it reaches through. */
export interface SummaryAsSeen {
  complete?: boolean;
  folds?: number;
  throughRequestId?: string;
}

/** What {@link foldOf} needs of a client: the session state and request routes. */
export interface SessionReads {
  sessions: {
    state(sessionId: string): Promise<unknown>;
    requests(sessionId: string, options?: { limit?: number }): Promise<unknown>;
  };
}

/** The `historySummary` resource's public state on `sessionId`, or `undefined` when the session holds none. */
export async function summaryAsSeen(client: { sessions: { state(sessionId: string): Promise<unknown> } }, sessionId: string): Promise<SummaryAsSeen | undefined> {
  const snapshot = (await client.sessions.state(sessionId)) as { resources?: { session?: Record<string, { clientData?: SummaryAsSeen } | undefined> } };
  return snapshot.resources?.session?.historySummary?.clientData;
}

/** A session's request as the requests route lists it, as far as the window needs it. */
type WindowRequest = { id: string; createdAt?: number; startedAtMs?: number; historyStart?: { requestId?: string } | null };

/**
 * The history window the server applied to a session's latest request, in
 * turns, read off the session's own record: the requests from the one its
 * `historyStart` names up to the latest. `undefined` while the latest request
 * carries no `historyStart`, which is while every earlier turn still fits.
 * A goal reads the window this way, never as a constant, because no route
 * serves a flow's `historyWindow` setting.
 */
export function historyWindowOf(requests: readonly WindowRequest[]): number | undefined {
  const ordered = [...requests].sort((a, b) => (a.startedAtMs ?? a.createdAt ?? 0) - (b.startedAtMs ?? b.createdAt ?? 0));
  const start = ordered.at(-1)?.historyStart?.requestId;
  if (start === undefined) return undefined;
  const from = ordered.findIndex((r) => r.id === start);
  return from < 0 ? undefined : ordered.length - 1 - from;
}

/** {@link historyWindowOf} for a session, read over the client. */
export async function sessionWindow(client: SessionReads, sessionId: string): Promise<number | undefined> {
  return historyWindowOf((await client.sessions.requests(sessionId, { limit: 200 })) as WindowRequest[]);
}

/**
 * A session's fold, as two records agree on it: the summary counts at least
 * one fold, and the session's latest request carries a `historyStart` naming
 * one of the session's own requests. Either alone is not a fold.
 */
export async function foldOf(client: SessionReads, sessionId: string): Promise<{ folded: boolean; folds: number; historyStart: string | undefined }> {
  const seen = await summaryAsSeen(client, sessionId);
  const requests = (await client.sessions.requests(sessionId, { limit: 200 })) as Array<{ id: string; createdAt?: number; startedAtMs?: number; historyStart?: { requestId?: string } | null }>;
  const latest = [...requests].sort((a, b) => (a.startedAtMs ?? a.createdAt ?? 0) - (b.startedAtMs ?? b.createdAt ?? 0)).at(-1);
  const historyStart = latest?.historyStart?.requestId;
  const folds = seen?.folds ?? 0;
  const ids = new Set(requests.map((r) => r.id));
  return { folded: folds > 0 && historyStart !== undefined && ids.has(historyStart), folds, historyStart };
}
