/**
 * Leg w: every client write to a user or org resource is a request in a flow.
 *
 * - `w:routes` reads the router's own route table and puts every route that
 *   isn't a read in a class. The action routes are how a client writes. The
 *   content routes are probed at user and org scope on a skills collection,
 *   whose content grants every write: each must answer 501 (the exemption,
 *   by name, until FIX-2633). A route in no class fails, so a route added
 *   later is graded without editing this file.
 * - `w:no-runby`: a client write to a resource with no `runBy` is refused,
 *   by the action route and by a content route, and nothing is stored.
 * - `w:recorded`: every user or org resource version written while the legs
 *   ran matches a request, in a session of a flow, by the signed-in user,
 *   running when the version was written.
 */
import { createClient, viewRef } from "@flow-state-dev/client";
import { watchView } from "@flow-state-dev/client/internal";
import { appPins } from "../../../labs/claude-code-style/flows/user-marks.mts";
import { listFlowRoutes } from "../../../packages/engine/src/routes/router.ts";
import type { Tell } from "../../lib/index.mts";
import { PINS_SEEN_VIEW, probeResources, PROBE_FLOW } from "./probe-flow.mts";
import type { Store, Version } from "./store.mts";

/** Every route that isn't a read, by what it does to a user or org resource. */
const CLASSES: Record<string, "action" | "content" | "no resource write"> = {
  // The action route: a write here is a request in a flow, the resource's own or the default write flow.
  execute_action: "action",
  send_resource: "action",
  // A request's next step, in the flow it ran in: a write it makes is that request's.
  resume_suspension: "action",
  answer_suspension: "action",
  retry_request: "action",
  continue_request: "action",
  // The content routes: session scope only; user and org answer 501 until FIX-2633.
  create_collection_item: "content",
  update_resource_content: "content",
  delete_collection_item: "content",
  // Writes no resource: a session, its metadata, a blob, a stream token, a view's read, a stop.
  create_session: "no resource write",
  delete_session: "no resource write",
  patch_session_metadata: "no resource write",
  upload_blob: "no resource write",
  transcribe: "no resource write",
  user_stream_mint: "no resource write",
  check_interrupted_requests: "no resource write",
  run_view: "no resource write",
  abort_request: "no resource write",
};

/** The content routes' three writes on resource `ref`, as a client sends them. */
function contentWrites(api: string, sessionId: string, ref: string) {
  const at = `${api}/sessions/${encodeURIComponent(sessionId)}/resources/${ref}`;
  const json = { "content-type": "application/json" };
  return {
    create: () => fetch(at, { method: "POST", headers: json, body: JSON.stringify({ topic: "closure-probe" }) }),
    update: () => fetch(`${at}/closure-probe/content`, { method: "PATCH", headers: json, body: JSON.stringify({ content: "written by a content route" }) }),
    delete: () => fetch(`${at}/closure-probe`, { method: "DELETE" }),
  };
}

/** `w:routes` and `w:no-runby`, on the lab at `origin` as `user`. */
export async function probeWrites(origin: string, user: string, store: Store, failures: string[], notes: string[], tell: Tell): Promise<void> {
  const api = `${origin}/api/flows`;
  const fsd = createClient({ userId: user, baseUrl: origin });
  const sessionId = (await fsd.flow(PROBE_FLOW).createSession()).id;
  const stored = () => store.resources().filter((r) => /closure-/.test(r.resource_key)).map((r) => `${r.scope_type}:${r.resource_key}@${r.version}`);
  const before = stored();

  // ── w:routes
  const writes = tell.over("w:routes · routes that aren't reads", listFlowRoutes().filter((r) => r.method !== "GET"));
  for (const route of writes) {
    if (CLASSES[route.kind] === undefined) failures.push(`w:routes: ${route.method} ${route.pattern} (${route.kind}) is in no class: can it change a user or org resource?`);
  }
  const probed: string[] = [];
  for (const ref of ["userSkills", "orgSkills"] as const) {
    const scope = probeResources[ref].scope;
    for (const [write, send] of Object.entries(contentWrites(api, sessionId, ref))) {
      const res = await send();
      // Long enough for the store's watcher to see a version a route wrote, before the next write replaces it.
      await new Promise((r) => setTimeout(r, 400));
      probed.push(`${write} at ${scope}: ${res.status}`);
      if (res.status !== 501) failures.push(`w:routes: client.content ${write} at ${scope} scope answered ${res.status}, not 501: ${(await res.text()).slice(0, 160)}`);
    }
  }
  notes.push(`w:routes: ${writes.length} routes that aren't reads, each in a class; content routes ${probed.join(", ")}`);

  // ── w:no-runby: through the action route, then through a content route.
  const requestsBefore = store.requests().length;
  const viaAction = await fsd
    .resource(probeResources.notes)
    .update(() => ({ text: "written with no runBy" }))
    .then(() => "written", (error: unknown) => `refused: ${error instanceof Error ? error.message : String(error)}`);
  if (viaAction === "written") failures.push("w:no-runby: the action route wrote closure-notes, a user resource with no runBy");
  const viaContent = await contentWrites(api, sessionId, "noteBook").create();
  if (viaContent.status < 400) failures.push(`w:no-runby: a content route answered ${viaContent.status} for noteBook, a user collection with no runBy`);
  notes.push(`w:no-runby: action route ${viaAction.slice(0, 160)}; content route ${viaContent.status}`);
  const after = stored();
  if (after.join() !== before.join()) failures.push(`w:no-runby / w:routes: the probes changed the store: ${after.filter((x) => !before.includes(x)).join(", ")}`);
  if (store.requests().length !== requestsBefore && viaAction !== "written") notes.push(`w:no-runby: ${store.requests().length - requestsBefore} request(s) recorded by the refused writes`);
}

/**
 * What a write session is for: the scope and the resource's pattern its id names
 * (`fsd-write.<base64url JSON [scope, pattern, …]>.<signature>`), or undefined for any other session.
 */
function writeSessionTarget(sessionId: string): { scope: string; pattern: string } | undefined {
  const m = /(?:^|:)fsd-write\.([A-Za-z0-9_-]+)\./.exec(sessionId);
  if (m === null) return undefined;
  try {
    const [scope, pattern] = JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as [string, string];
    return typeof scope === "string" && typeof pattern === "string" ? { scope, pattern } : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `key` is held by a resource whose pattern is `pattern` (a single resource's ref, or a collection's `prefix/**` or `prefix/*`). */
const underPattern = (key: string, pattern: string) => key === pattern || (/\/\*\*?$/.test(pattern) && key.startsWith(pattern.replace(/\*\*?$/, "")));

/**
 * `w:recorded`: each write (a version, or a delete) matches a request that
 * touched that very resource: by the signed-in user, in a session the store
 * holds, running when it was written, and either streaming a
 * `resource_change` for its scope and key or running in the write session
 * the server keeps for that resource. Overlapping in time alone isn't
 * enough: a direct write made while some other request runs would pass that.
 * Writes the log missed (`gaps`) fail too, since the grade can't claim it saw them.
 * Hands back the evidence, and how many writes a time-only match would have passed.
 */
export function recordedWrites(versions: readonly Version[], gaps: readonly string[], store: Store, user: string, since: number, failures: string[], tell: Tell, slackMs = 250): string {
  const graded = tell.over("w:recorded · user and org writes", versions);
  for (const gap of gaps) failures.push(`w:recorded: the write log skipped a version: ${gap}`);
  const requests = store.requests(since).filter((r) => r.session_id !== null && r.user_id === user);
  const sessions = new Set(store.sessions().map((s) => s.id));
  const changes = store.changesByRequest();
  let matched = 0;
  let byTimeAlone = 0;
  const flows = new Map<string, number>();
  for (const v of graded) {
    const running = requests.filter((r) => sessions.has(r.session_id!) && r.created_at <= v.seenAt + slackMs && r.updated_at >= v.seenAt - slackMs);
    if (running.length > 0) byTimeAlone += 1;
    const by = running.find((r) => {
      if (changes.get(r.id)?.has(`${v.scope}|${v.key}`)) return true;
      const target = writeSessionTarget(r.session_id!);
      return target !== undefined && target.scope === v.scope && underPattern(v.key, target.pattern);
    });
    if (by === undefined) {
      failures.push(`w:recorded: ${v.scope} ${v.key} ${v.op === "delete" ? "deleted" : `v${v.version}`} (${new Date(v.seenAt).toISOString()}) matches no request by ${user} that touched it (${running.length} other request(s) were running)`);
      continue;
    }
    matched += 1;
    flows.set(by.flow_kind, (flows.get(by.flow_kind) ?? 0) + 1);
  }
  return `${matched} of ${graded.length} writes matched a request that touched the resource (${[...flows].map(([f, n]) => `${f} ${n}`).join(", ")}); by time alone ${byTimeAlone} would have; ${gaps.length} gap(s)`;
}

/**
 * The gap sweep's seam, O2's host-wide publish (FIX-2623 against FIX-2624): a pin written through
 * the default write flow reaches a view in another flow that reads it, within 1 s, five times, none
 * retried. The view is watched with no poll timer, so only the change notice can wake it.
 */
export async function pinSeam(origin: string, user: string, failures: string[], notes: string[], tell: Tell): Promise<void> {
  const fsd = createClient({ userId: user, baseUrl: origin });
  const seen: { at: number; pinned: string[] }[] = [];
  const stop = watchView<{ pinned: string[] }>(fsd as never, viewRef(PROBE_FLOW, PINS_SEEN_VIEW), {}, { onValue: (value) => seen.push({ at: Date.now(), pinned: value?.pinned ?? [] }) }, { pollIntervalMs: null });
  try {
    await new Promise((r) => setTimeout(r, 2_000));
    const latencies: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const id = `closure-seam-${i}-${Date.now()}`;
      await fsd.resource(appPins).update((s) => ({ pinned: [...s.pinned, id] }));
      const written = Date.now();
      let reached: number | undefined;
      for (const end = written + 3_000; Date.now() < end && reached === undefined; await new Promise((r) => setTimeout(r, 20))) {
        reached = seen.find((v) => v.pinned.includes(id))?.at;
      }
      if (reached === undefined) failures.push(`seam:pin-reaches-view: pin ${i} never reached ${PROBE_FLOW}'s ${PINS_SEEN_VIEW} view within 3 s of its write`);
      else {
        latencies.push(reached - written);
        if (reached - written > 1_000) failures.push(`seam:pin-reaches-view: pin ${i} reached the view ${reached - written} ms after its write landed, over 1000`);
      }
    }
    tell.over("seam:pin-reaches-view · pins that reached the other flow's view", latencies);
    notes.push(`seam: 5 pins through the default write flow; the other flow's view saw them ${latencies.map((l) => `${l} ms`).join(", ")} after each write landed`);
  } finally {
    stop();
  }
}
