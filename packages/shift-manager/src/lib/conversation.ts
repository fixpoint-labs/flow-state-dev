/**
 * One user's conversation with one worker, read from the worker's session.
 *
 * The session is the worker's derived address: `ensureWorkerSession({ worker })`
 * opens it, and another worker's message lands there. A session at any other
 * id is not this view's. Items are read when the view opens, after each
 * line, and every {@link MESSAGES_POLL_MS} while it is open (another worker's
 * message can land at any time), never on the snapshot's refresh. Nothing is
 * sent until the first read has landed, and a session a line opened here
 * holds nothing the user hasn't seen. A failed later read keeps the last one
 * on screen; only a failed first read shows.
 */
import { useCallback, useEffect, useState } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { COORDINATOR_FLOW, deriveWorkerSessionId } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import { MESSAGES_POLL_MS } from "./messages";
import { describeFailure, workerOf, type Failure, type Worker } from "./reads";
import { readSessionItems, RunReadError, type SessionItems } from "./run";
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
 * The worker's derived conversation id for the signed-in user.
 */
function useDerivedId(worker: Pick<Worker, "id" | "kind"> | undefined): Derived {
  const { client, snapshot } = useLab();
  const orgId = snapshot !== undefined && "orgId" in snapshot ? snapshot.orgId : undefined;
  const flow = worker?.kind ?? null;
  const id = worker?.id;
  const [derived, setDerived] = useState<{ key: string; id: string | null; failure?: Failure } | null>(null);
  const key = orgId === undefined || flow === null || id === undefined ? null : `${client.userId}\n${orgId}\n${flow}\n${id}`;
  useEffect(() => {
    if (key === null || orgId === undefined || flow === null || id === undefined) return;
    let closed = false;
    derivedIdOf(key, { userId: client.userId, orgId, flow, criteria: { worker: id } }).then(
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
  }, [key, client.userId, orgId, flow, id]);
  if (key === null) return { id: null, failure: undefined };
  return derived !== null && derived.key === key ? { id: derived.id, failure: derived.failure } : { id: undefined, failure: undefined };
}

/** The derived session once the snapshot lists it, for a view that reads the session without drawing it. */
export function useConversationSession(worker: Pick<Worker, "id" | "kind"> | undefined, sessions: readonly SessionSummary[]): string | null {
  return conversationAt(sessions, useDerivedId(worker).id ?? null, null);
}

export interface WorkerConversation {
  /** The conversation's session, or `null` before a first line. */
  sessionId: string | null;
  /** The session a first line opened here, until the snapshot lists it. */
  opened: string | null;
  /** What the session stores, once read, for the session shown. */
  read: SessionItems | undefined;
  /** Why the first read failed; cleared by the next that succeeds. A failed later read keeps the last one. */
  failure: Failure | undefined;
  /** Read the session again. */
  reread(): void;
  /** The conversation's address is still being worked out: nothing is sent until it is. */
  resolving: boolean;
  /** The session a line goes to, opening the derived address on the first line. */
  ensure(): Promise<string>;
}

/** `pinned` is the session the view found: that one, whatever the snapshot lists. */
export function useWorkerConversation(worker: Worker, sessions: readonly SessionSummary[], pinned?: string): WorkerConversation {
  const { client } = useLab();
  const workforce = useWorkforce();
  const { id: derived, failure: underived } = useDerivedId(pinned === undefined ? worker : undefined);
  const [opened, setOpened] = useState<string | null>(null);
  const sessionId = pinned ?? conversationAt(sessions, derived ?? null, opened);
  const resolving = pinned === undefined && opened === null && derived === undefined;
  // The last read that succeeded, and whose session it read. A re-read keeps it
  // on screen until the new one lands.
  const [stored, setStored] = useState<{ sessionId: string; read: SessionItems } | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (sessionId === null) return;
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readSessionItems(client, sessionId)
      .then((read) => {
        if (closed) return;
        setStored({ sessionId, read });
        setFailure(undefined);
      })
      .catch((error: unknown) => {
        if (!closed) setFailure(error instanceof RunReadError ? error.failure : describeFailure(error));
      })
      .finally(() => {
        if (!closed) next = setTimeout(() => setReads((n) => n + 1), MESSAGES_POLL_MS);
      });
    return () => {
      closed = true;
      if (next !== undefined) clearTimeout(next);
    };
  }, [client, sessionId, reads]);

  const reread = useCallback(() => setReads((n) => n + 1), []);
  const ensure = useCallback(async () => {
    if (sessionId !== null) return sessionId;
    const session = await workforce.ensureWorkerSession({ worker: worker.id });
    setOpened(session.id);
    return session.id;
  }, [sessionId, workforce, worker.id]);

  const read = sessionId !== null && stored?.sessionId === sessionId ? stored.read : undefined;
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
