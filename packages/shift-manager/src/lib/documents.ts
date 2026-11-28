// BR-10.
/**
 * The declared documents a browser may read, for Jump to: each listed flow's
 * manifest, read once per flow through the first listed session of it, and
 * cached by flow for the page, since a manifest is a property of the flow and
 * static per flow. The session is only its address. A document no flow
 * serves, or a flow no listed session runs, is not found.
 */
import { useEffect, useState } from "react";
import type { Client, ResourceManifest, SessionSummary } from "@flow-state-dev/client";
import { useLab } from "./lab-data";
import { useSessions } from "./directory";
import { describeFailure, type Section } from "./failure";

/** A declared document the Lab serves to a browser, and a listed session whose flow serves it, to read it through. */
type DeclaredDocument = { ref: string; sessionId: string };

/** Manifests read, per connection and flow; a failed read is not kept, so the next open reads it again. */
const manifests = new WeakMap<object, Map<string, Promise<ResourceManifest>>>();

function manifestFor(client: Pick<Client, "resources">, flow: string, sessionId: string): Promise<ResourceManifest> {
  let byFlow = manifests.get(client);
  if (byFlow === undefined) {
    byFlow = new Map();
    manifests.set(client, byFlow);
  }
  const held = byFlow;
  let found = held.get(flow);
  if (found === undefined) {
    found = client.resources.getResourceManifest(sessionId);
    found.catch(() => held.delete(flow));
    held.set(flow, found);
  }
  return found;
}

/** Each listed flow, and the first listed session of it: the address its documents are read through. */
function sessionByFlow(sessions: readonly SessionSummary[]): Map<string, string> {
  const byFlow = new Map<string, string>();
  for (const session of sessions) {
    const flow = session.flowId ?? session.flowKind;
    if (!byFlow.has(flow)) byFlow.set(flow, session.id);
  }
  return byFlow;
}

/** Every listed flow's single resources whose content a client may read, by ref. */
export async function documentsOf(client: Pick<Client, "resources">, sessions: readonly SessionSummary[]): Promise<DeclaredDocument[]> {
  const byFlow = sessionByFlow(sessions);
  const found = new Map<string, DeclaredDocument>();
  for (const [flow, sessionId] of byFlow) {
    for (const entry of (await manifestFor(client, flow, sessionId)).resources) {
      if (entry.kind === "single" && entry.client.content?.read === true && !found.has(entry.ref)) found.set(entry.ref, { ref: entry.ref, sessionId });
    }
  }
  return [...found.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

/** Each listed flow with the session its documents are read through, as one comparable string. */
function addressesOf(sessions: readonly SessionSummary[]): string {
  return [...sessionByFlow(sessions)].map(([flow, id]) => `${flow}=${id}`).sort().join("\n");
}

/**
 * The declared documents, read while the screen that draws them is open (Jump
 * to), once the session list has landed, and again when a flow appears in it
 * or the session a flow's documents are addressed through leaves it.
 * `undefined` while they are read.
 */
export function useDocuments(): Section<DeclaredDocument[]> | undefined {
  const { client } = useLab();
  const sessions = useSessions().list;
  const [read, setRead] = useState<{ addresses: string; section: Section<DeclaredDocument[]> } | undefined>(undefined);
  const addresses = sessions === undefined ? undefined : addressesOf(sessions);
  useEffect(() => {
    if (sessions === undefined || addresses === undefined) return;
    let live = true;
    documentsOf(client, sessions).then(
      (documents) => live && setRead({ addresses, section: { ok: true, value: documents } }),
      (error: unknown) => live && setRead({ addresses, section: { ok: false, failure: describeFailure(error) } }),
    );
    return () => {
      live = false;
    };
    // Each flow and the session it is read through decide what is read: a session list that keeps
    // both reads nothing new. A new address for a known flow reuses its cached manifest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, addresses]);
  // A read for other addresses is never this one's answer: unread until it lands.
  return read !== undefined && read.addresses === addresses ? read.section : undefined;
}
