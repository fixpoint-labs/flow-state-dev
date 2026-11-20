// FIX-2466.
/**
 * One user's conversation with one worker, read from the worker's session.
 *
 * The session is the worker's derived address: `ensureWorkerSession({ worker })`
 * opens it, and another worker's message lands there. A session at any other
 * id is not this view's. A project's conversation (`project`) is the one
 * `ensureWorkerSession({ worker, projectId })` opens, on its first line. Items are read when the view opens and then
 * followed on the session stream, through the page's one feed for the session (`useSharedSessionFeed`): a line sent here,
 * a reply, another worker's message, each shows as it is stored, from any
 * process, and nothing is read on a clock.
 * Nothing is sent until the first read has landed, and a session
 * a line opened here holds nothing the user hasn't seen. A lapse after the
 * first read keeps it on screen; only a failed first read shows.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { COORDINATOR_FLOW, deriveWorkerSessionId, type ProjectAddressRef } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import { useReportFeedState } from "./feed-health";
import { describeFailure, type Failure } from "./failure";
import { workerOf, type Worker } from "./workers";
import { useRetrySessionFeed, useSharedSessionFeed } from "./session-feeds";
import { useWorkforce } from "./workforce";

/** The flow a coordinator worker runs on, whose conversations carry its delegates' answers. */
export { COORDINATOR_FLOW };

/** Another worker's id on `agentName`, or `undefined` when this worker wrote it or the name is a generator's. */
export function senderOf(worker: Pick<Worker, "id">, item: { readonly agentName?: string }, known: ReadonlySet<string>): string | undefined {
  const author = item.agentName;
  return author === undefined || author === worker.id || !known.has(author) ? undefined : author;
}

/** Workers the inventory registers, and every worker a listed session runs. A sender's id is one of those. */
export function knownWorkers(workers: readonly Pick<Worker, "id">[], sessions: readonly SessionSummary[]): Set<string> {
  const known = new Set(workers.map((worker) => worker.id));
  for (const session of sessions) {
    const id = workerOf(session);
    if (id !== null) known.add(id);
  }
  return known;
}

/** The session a first line opened, else the derived id once the listing holds it. */
export function conversationAt(sessions: readonly SessionSummary[], derived: string | null, opened: string | null): string | null {
  if (opened !== null) return opened;
  if (derived === null) return null;
  return sessions.some((session) => session.id === derived) ? derived : null;
}

/** Derivations by user, organization, flow and worker, so two views of one conversation hash it once. */
const derivations = new Map<string, Promise<string>>();

function derivedIdOf(key: string, input: Parameters<typeof deriveWorkerSessionId>[0]): Promise<string> {
  let pending = derivations.get(key);
  if (pending === undefined) {
    pending = deriveWorkerSessionId(input);
    // A failed derivation is not kept, so a later view can try again.
    pending.catch(() => derivations.delete(key));
    derivations.set(key, pending);
  }
  return pending;
}

/** The derived conversation id, while it is computed, and why it couldn't be. */
interface Derived {
  /** `undefined` while it is computed, `null` when it can't be (no worker, no flow, no organization yet, or a failure). */
  id: string | null | undefined;
  /** Why it couldn't be computed: on a page served over plain HTTP from a host that isn't this machine, the browser has no Web Crypto to hash it with. */
  failure: Failure | undefined;
}

/**
 * The worker's derived conversation id for the signed-in user, under the
 * organization workforce's `organization()` reads (once per page: the gate
 * already read it).
 */
function useDerivedId(worker: Pick<Worker, "id" | "kind"> | undefined): Derived {
  const { client } = useLab();
  const workforce = useWorkforce();
  const flow = worker?.kind ?? null;
  const id = worker?.id;
  const [derived, setDerived] = useState<{ key: string; id: string | null; failure?: Failure } | null>(null);
  const key = flow === null || id === undefined ? null : `${client.userId}\n${flow}\n${id}`;
  useEffect(() => {
    if (key === null || flow === null || id === undefined) return;
    let closed = false;
    workforce
      .organization()
      .then((orgId) => derivedIdOf(`${key}\n${orgId}`, { userId: client.userId, orgId, flow, criteria: { worker: id } }))
      .then(
      (sessionId) => {
        if (!closed) setDerived({ key, id: sessionId });
      },
      (error: unknown) => {
        if (!closed) setDerived({ key, id: null, failure: describeFailure(error) });
      }
    );
    return () => {
      closed = true;
    };
  }, [key, workforce, client.userId, flow, id]);
  if (key === null) return { id: null, failure: undefined };
  return derived !== null && derived.key === key ? { id: derived.id, failure: derived.failure } : { id: undefined, failure: undefined };
}

/** The derived session once the session list holds it, for a view that reads the session without drawing it. */
export function useConversationSession(worker: Pick<Worker, "id" | "kind"> | undefined, sessions: readonly SessionSummary[]): string | null {
  return conversationAt(sessions, useDerivedId(worker).id ?? null, null);
}

export interface WorkerConversation {
  /** The conversation's session, or `null` before a first line. */
  sessionId: string | null;
  /** The session a first line opened here, until the session list holds it. */
  opened: string | null;
  /**
   * What the session stores, once read, for the session shown: its newest
   * items, whether it holds older ones, and the call that adds the page before.
   */
  read: { items: OutputItem[]; truncated: boolean; loadEarlier?: () => Promise<void> } | undefined;
  /** Why the first read failed; cleared by the next that succeeds. A failed later read keeps the last one. */
  failure: Failure | undefined;
  /** Read the session again from scratch after a failed first read (Retry): the page's feed for it opens anew. */
  reread(): void;
  /** The conversation's address is still being worked out: nothing is sent until it is. */
  resolving: boolean;
  /** The session a line goes to, opening the derived address on the first line. */
  ensure(): Promise<string>;
}

/**
 * `pinned` is the session the view found: that one, whatever the session list holds.
 * `project`, with nothing pinned, is the project a view's conversation is linked to (a
 * project's Stream): it has no session until the first line opens one linked to it,
 * and the worker's own conversation is never read in its place.
 */
export function useWorkerConversation(
  worker: Worker,
  sessions: readonly SessionSummary[],
  pinned?: string,
  project?: ProjectAddressRef
): WorkerConversation {
  const workforce = useWorkforce();
  const { id: derived, failure: underived } = useDerivedId(pinned === undefined && project === undefined ? worker : undefined);
  const [opened, setOpened] = useState<string | null>(null);
  const sessionId = pinned ?? conversationAt(sessions, derived ?? null, opened);
  const resolving = pinned === undefined && opened === null && derived === undefined;
  // The page's one feed for the session: it reconnects on its own, and a lapse keeps what it read.
  const feed = useSharedSessionFeed(sessionId);
  useReportFeedState(sessionId === null ? undefined : feed?.state);
  const items = feed?.items;
  const hasEarlier = feed?.hasEarlier ?? false;
  const loadEarlier = feed?.loadEarlier;
  const read = useMemo(
    () => (items === undefined ? undefined : { items: [...items], truncated: hasEarlier, ...(hasEarlier && loadEarlier !== undefined ? { loadEarlier } : {}) }),
    [items, hasEarlier, loadEarlier],
  );
  // Only a first read that failed shows: once items landed, a lapse keeps them.
  const failure = read === undefined && feed?.error != null ? describeFailure(feed.error) : undefined;
  const retry = useRetrySessionFeed(sessionId);
  // Only a feed with nothing read is opened again: a live one already brings every change.
  const reread = useCallback(() => {
    if (failure !== undefined) retry();
  }, [failure, retry]);
  const ensure = useCallback(async () => {
    if (sessionId !== null) return sessionId;
    const session = await workforce.ensureWorkerSession(project === undefined ? { worker: worker.id } : { worker: worker.id, projectId: project });
    setOpened(session.id);
    return session.id;
  }, [sessionId, workforce, worker.id, project]);

  return {
    sessionId,
    opened,
    read,
    failure: (read === undefined ? failure : undefined) ?? underived,
    reread,
    resolving,
    ensure
  };
}
