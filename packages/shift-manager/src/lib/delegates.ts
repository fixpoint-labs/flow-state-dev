/**
 * A coordinator conversation's delegates, through the coordinator's own
 * actions: `listDelegates` reads them, `addDelegate` and `removeDelegate`
 * change them. Each runs on the conversation's session, so a change stays in
 * that conversation. The coordinator checks every add against the person's
 * roster; a refusal comes back as a `TalkRefused` carrying its reason.
 */
import type { LabClients } from "./connection";
import { runTalkAction } from "./talk";

/** One delegate: a worker on the person's roster, and what it's good at. */
export type Delegate = { worker: string; note?: string };

/** The conversation's delegates, and the most it can hold. */
export type DelegateList = { delegates: Delegate[]; max: number };

function asList(output: unknown): DelegateList {
  const value = (output ?? {}) as { delegates?: unknown; max?: unknown };
  const delegates = Array.isArray(value.delegates) ? (value.delegates as Delegate[]) : [];
  return { delegates, max: typeof value.max === "number" ? value.max : delegates.length };
}

/** Read the delegates of the coordinator conversation `sessionId` on `kind`. */
export async function readDelegates(clients: LabClients, kind: string, sessionId: string): Promise<DelegateList> {
  return asList((await runTalkAction(clients, kind, sessionId, "listDelegates", {})).output);
}

/** Add `worker` to the conversation's delegates. */
export async function addDelegate(clients: LabClients, kind: string, sessionId: string, worker: string): Promise<DelegateList> {
  return asList((await runTalkAction(clients, kind, sessionId, "addDelegate", { worker })).output);
}

/** Remove `worker` from the conversation's delegates. */
export async function removeDelegate(clients: LabClients, kind: string, sessionId: string, worker: string): Promise<DelegateList> {
  return asList((await runTalkAction(clients, kind, sessionId, "removeDelegate", { worker })).output);
}
