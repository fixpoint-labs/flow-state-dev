/**
 * A coordinator conversation's delegates, through the coordinator's own
 * actions: `listDelegates` reads them, `addDelegate` and `removeDelegate`
 * change them. Each runs on the conversation's session, so a change stays in
 * that conversation. The coordinator checks every add against the user's
 * roster; a refusal comes back as an `ActionRefused` carrying its reason.
 */
import type { Client } from "@flow-state-dev/client";
import { runAction } from "./action";

/** One delegate: a worker on the user's roster, and what it's good at. */
export type Delegate = { worker: string; note?: string };

/** The conversation's delegates, and the most it can hold. */
export type DelegateList = { delegates: Delegate[]; max: number };

function asList(output: unknown): DelegateList {
  const value = (output ?? {}) as { delegates?: unknown; max?: unknown };
  const delegates = Array.isArray(value.delegates) ? (value.delegates as Delegate[]) : [];
  return { delegates, max: typeof value.max === "number" ? value.max : delegates.length };
}

/** Read the delegates of the coordinator conversation `sessionId` on `flow`. */
export async function readDelegates(client: Client, flow: string, sessionId: string): Promise<DelegateList> {
  return asList((await runAction(client, flow, sessionId, "listDelegates", {})).output);
}

/** Add `worker` to the conversation's delegates. */
export async function addDelegate(client: Client, flow: string, sessionId: string, worker: string): Promise<DelegateList> {
  return asList((await runAction(client, flow, sessionId, "addDelegate", { worker })).output);
}

/** Remove `worker` from the conversation's delegates. */
export async function removeDelegate(client: Client, flow: string, sessionId: string, worker: string): Promise<DelegateList> {
  return asList((await runAction(client, flow, sessionId, "removeDelegate", { worker })).output);
}
