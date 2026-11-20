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

/** Every listed flow's single resources whose content a client may read, by ref. */
async function documentsOf(client: Pick<Client, "resources">, sessions: readonly SessionSummary[]): Promise<DeclaredDocument[]> {
  const byFlow = new Map<string, string>();
  for (const session of sessions) {
    const flow = session.flowId ?? session.flowKind;
    if (!byFlow.has(flow)) byFlow.set(flow, session.id);
  }
  const found = new Map<string, DeclaredDocument>();
  for (const [flow, sessionId] of byFlow) {
    for (const entry of (await manifestFor(client, flow, sessionId)).resources) {
      if (entry.kind === "single" && entry.client.content?.read === true && !found.has(entry.ref)) found.set(entry.ref, { ref: entry.ref, sessionId });
    }
  }
  return [...found.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

/**
 * The declared documents, read while the screen that draws them is open (Jump
 * to), once the session list has landed, and again when a flow appears in it.
 * `undefined` while they are read.
 */
export function useDocuments(): Section<DeclaredDocument[]> | undefined {
  const { client } = useLab();
  const sessions = useSessions().list;
  const [read, setRead] = useState<{ flows: string; section: Section<DeclaredDocument[]> } | undefined>(undefined);
  const flows = sessions === undefined ? undefined : [...new Set(sessions.map((s) => s.flowId ?? s.flowKind))].sort().join("\n");
  useEffect(() => {
    if (sessions === undefined || flows === undefined) return;
    let live = true;
    documentsOf(client, sessions).then(
      (documents) => live && setRead({ flows, section: { ok: true, value: documents } }),
      (error: unknown) => live && setRead({ flows, section: { ok: false, failure: describeFailure(error) } }),
    );
    return () => {
      live = false;
    };
    // The flows decide what is read; a session list that names the same flows reads nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, flows]);
  // A read for another set of flows is never this one's answer: unread until it lands.
  return read !== undefined && read.flows === flows ? read.section : undefined;
}
