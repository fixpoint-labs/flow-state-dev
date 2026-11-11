/**
 * The closure's coordination seams that run on fixtures (FIX-2565, epic
 * FIX-2516 "Coordination seams"), each walked once through the public routes
 * of a host in this process on a SQLite store and the engine's default local
 * blob folder. No model: each flow's blocks are handlers.
 *
 * - {@link walkTaskFiles}: a task filed from a message keeps its files after
 *   the message's session is deleted. The `desk` flow files through the task
 *   board's own `createTask` action (the block a model's tool runs), on a
 *   user-scoped board as a conversation's board is, with the turn's files
 *   beside its input.
 * - {@link walkSteerWithFile}: a line with a file, typed while a turn runs,
 *   becomes the next turn and is not steered into the running one. Driven
 *   through `useHarnessLines` from `@flow-state-dev/react`, rendered by
 *   react-dom over a happy-dom document, against a flow whose `turn` waits
 *   (`defer`) and whose `steer` takes every line it is handed.
 *
 * Each walk returns its failures and one line of evidence; the caller tags
 * them and floors what it read.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import * as React from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { createFlowState, createInProcessFetch } from "@flow-state-dev/engine";
import { FlowProvider, useHarnessLines, useSession, type HarnessLinesView, type SessionView } from "@flow-state-dev/react";
import { taskBoard, taskToolActions } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection, type TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { actingAs, RUN_STAMP, silentLogger, sleep } from "../../../lib/index.mts";
import { wordPng } from "../../reach-the-model/png.mts";

const ORG = "goal-org";
const BASE = "http://in-process.invalid";

/** What one walk found. */
export interface SeamResult {
  failures: string[];
  evidence: string;
}

const principal = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  return typeof user === "string" && user.length > 0 ? { userId: user, orgId: ORG } : null;
};

/** A host in this process on a fresh SQLite file under `scratch`, whose default blob folder is under `scratch` too. */
function host(scratch: string, name: string, flows: Record<string, unknown>) {
  mkdirSync(scratch, { recursive: true });
  // The engine's default local blob folder is under the working directory.
  process.chdir(scratch);
  return createFlowState({
    flows: Object.values(flows),
    stores: { default: { primary: sqliteStores({ filename: join(scratch, `${name}-${RUN_STAMP}.sqlite`) }) } },
    logger: silentLogger,
    resolvePrincipal: principal,
  } as never);
}

// ---------------------------------------------------------------------------
// A task filed from a message keeps its files after the session is deleted
// ---------------------------------------------------------------------------

const noopWorker = handler({ name: "closure-noop-worker", inputSchema: z.unknown(), outputSchema: z.null(), execute: () => null }) as TaskWorker;

/**
 * Upload a screenshot, file a task with it from a message in session A, read
 * the task's brief files, delete A, and read the task and its files again from
 * session B. The turn's own reference must read 404 once A is gone (so the
 * brief's survival is the copy's doing, not a file nobody owns), and the
 * brief's reference must read 200 with the uploaded bytes.
 */
export async function walkTaskFiles(scratch: string): Promise<SeamResult> {
  const failures: string[] = [];
  // User-scoped and exposing its brief's fields, as a conversation's board is (workforce's `conversationLedger`).
  const desk = Object.assign(defineTaskCollection({ id: "closure-desk", scope: "user" }), {
    client: { state: { read: true }, expose: ["id", "goal", "attachments", "status"] },
  });
  const board = taskBoard({ name: "closure-desk", collection: desk, workers: noopWorker });
  const actions = taskToolActions(board);
  const createName = Object.keys(actions).find((name) => name.startsWith("createTask"));
  if (createName === undefined) throw new Error(`setup: the board's actions hold no createTask: ${Object.keys(actions).join(", ")}`);
  const flow = defineFlow({
    kind: "desk",
    actions: {
      // The board's own createTask, as a message: the action that takes files writes the user line.
      file: { ...actions[createName]!, userMessage: (input: { goal: string }) => input.goal },
    },
  } as never)();
  const state = host(scratch, "task-files", { desk: flow });
  const alice = actingAs(state as never, "alice");
  const bytes = wordPng("SEAM");
  const shot = await alice.client.flow("desk").upload({ data: bytes, mediaType: "image/png", filename: "bug.png" });

  const filing = await alice.open("desk", {});
  const filed = (await sendWithFiles(alice, filing, { goal: "Fix the bug in the screenshot", assignee: "closure-noop-worker" }, [shot])) as {
    ok?: boolean;
    taskId?: string;
    error?: string;
  };
  if (filed?.ok !== true || typeof filed.taskId !== "string") {
    return { failures: [`filed: the message filed no task: ${JSON.stringify(filed)}`], evidence: "" };
  }
  const briefBefore = await briefFiles(alice, filing, filed.taskId);
  if (briefBefore.length !== 1) failures.push(`brief: the filed task holds ${briefBefore.length} files, not the message's one: ${JSON.stringify(briefBefore)}`);
  const briefRef = briefBefore[0]?.data ?? "";
  if (briefRef === shot.data) failures.push("brief: the task holds the message's own reference, not a copy a session delete can't take");

  await alice.client.sessions.delete(filing);
  const other = await alice.open("desk", {});
  const briefAfter = await briefFiles(alice, other, filed.taskId);
  const sameRef = briefAfter.map((f) => f.data).includes(briefRef);
  if (!sameRef) failures.push(`kept: after the session's delete, the task's brief no longer names its file: ${JSON.stringify(briefAfter)}`);
  const kept = await readBlob(state, "alice", briefRef);
  if (kept.status !== 200) failures.push(`kept: after the session's delete, the brief's file reads ${kept.status}`);
  else if (Buffer.compare(kept.bytes, Buffer.from(bytes)) !== 0) failures.push("kept: the brief's file reads back other bytes than were uploaded");
  const turnOwn = await readBlob(state, "alice", shot.data);
  if (turnOwn.status !== 404) failures.push(`delete: the message's own file reads ${turnOwn.status} after its session's delete, not 404`);
  const stranger = await readBlob(state, "bob", briefRef);
  if (stranger.status !== 404) failures.push(`other-user: Bob reads the brief's file with ${stranger.status}, not 404`);
  return {
    failures,
    evidence: `filed ${filed.taskId} with 1 file, its brief a copy (${briefRef.slice(0, 18)}…); after the session's delete the brief reads ${kept.status}, the message's own file ${turnOwn.status}, Bob ${stranger.status}`,
  };
}

type Acting = ReturnType<typeof actingAs>;

/** Send `action`-less `file` with `attachments` beside the input and read its answer back from the ended request. */
async function sendWithFiles(who: Acting, sessionId: string, input: unknown, attachments: FileContent[]): Promise<unknown> {
  const sent = await who.client.flow("desk").send("file", input, { sessionId, attachments });
  const { status } = await sent.wait({ pollMs: 20, timeoutMs: 20_000 });
  const found = (await who.client.sessions.requests(sessionId, { includeResultOutput: true, limit: 50 })).find((r) => r.id === sent.id);
  if (status !== "completed") throw new Error(`setup: filing ended ${status}: ${JSON.stringify(found?.result ?? null)}`);
  return found?.result?.output;
}

/**
 * The task's brief files as a task screen reads them: the board's collection,
 * found through `sessionId`'s manifest, read on the resource route; its row's
 * `attachments`. (The board's `getTask` view carries no files.)
 */
async function briefFiles(who: Acting, sessionId: string, taskId: string): Promise<FileContent[]> {
  const manifest = JSON.parse((await who.call("GET", ["sessions", sessionId, "manifest"])).text) as { resources?: Array<{ kind: string; ref: string; pattern?: string }> };
  const ref = manifest.resources?.find((r) => r.kind === "collection" && (r.pattern ?? r.ref).includes("closure-desk"))?.ref;
  if (ref === undefined) throw new Error(`setup: session ${sessionId}'s manifest names no closure-desk collection: ${JSON.stringify(manifest.resources)}`);
  const page = await who.call("GET", ["sessions", sessionId, "resources", encodeURIComponent(ref)], undefined, "?limit=200");
  if (page.status !== 200) throw new Error(`setup: the board's rows read ${page.status}: ${page.text.slice(0, 200)}`);
  const rows = ((JSON.parse(page.text) as { items?: Array<{ clientData?: { id?: string; attachments?: FileContent[] } }> }).items ?? []).map((i) => i.clientData ?? {});
  return rows.find((row) => row.id === taskId)?.attachments ?? [];
}

/** A file's read through the read route, as `user`: its status and its bytes, unread as text. */
async function readBlob(state: unknown, user: string, ref: string): Promise<{ status: number; bytes: Buffer }> {
  const id = parseBlobRef(ref);
  if (id === undefined) return { status: 0, bytes: Buffer.alloc(0) };
  const response = await createInProcessFetch(state as never)(`/api/flows/blobs/${encodeURIComponent(id)}` as never, { headers: { "x-user": user } } as never);
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
}

// ---------------------------------------------------------------------------
// A steer with a file becomes the next turn
// ---------------------------------------------------------------------------

/** Lines the `steer` action took into the running turn, in order. */
const steered: string[] = [];
/** Release for the turn that is holding. */
let releaseTurn: (() => void) | undefined;

/**
 * Start a turn that holds; while it runs, send a text line (it must be steered:
 * the proof the steer path is live, so the file leg can fail) and then a line
 * with a screenshot. The file line must answer `after-this-turn`, reach no
 * steer, and once the first turn ends run as the next `turn` request, its
 * user line holding the file's reference.
 */
export async function walkSteerWithFile(scratch: string): Promise<SeamResult> {
  const failures: string[] = [];
  const turnInput = z.object({ prompt: z.string() });
  const turn = handler({
    name: "closure-turn",
    inputSchema: turnInput,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => {
      // Only the first turn holds: the walk releases it once both lines are sent.
      if (releaseTurn === undefined) await new Promise<void>((resolve) => (releaseTurn = resolve));
      return { ok: true };
    },
  });
  const steer = handler({
    name: "closure-steer",
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: z.object({ taken: z.boolean(), live: z.boolean() }),
    execute: async (input) => {
      steered.push(input.prompt);
      return { taken: true, live: true };
    },
  });
  const flow = defineFlow({
    kind: "lines",
    actions: {
      turn: { inputSchema: turnInput, block: turn, concurrency: "defer", userMessage: (i: { prompt: string }) => i.prompt },
      steer: { inputSchema: z.object({ prompt: z.string() }), block: steer, concurrency: "allow" },
    },
  } as never)();
  const state = host(scratch, "steer", { lines: flow });
  const alice = actingAs(state as never, "alice");
  const shot = await alice.client.flow("lines").upload({ data: wordPng("STEER"), mediaType: "image/png", filename: "shot.png" });
  const sessionId = await alice.open("lines", {});

  const happy = new Window();
  Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false, React });
  const inProcess = createInProcessFetch(state as never);
  const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("x-user", "alice");
    return inProcess(input as never, { ...init, headers } as never);
  };
  let session: SessionView | undefined;
  let lines: HarnessLinesView | undefined;
  const Screen = () => {
    session = useSession(sessionId, { flowKind: "lines" });
    lines = useHarnessLines(session);
    return null;
  };
  const mount = happy.document.createElement("div");
  happy.document.body.appendChild(mount);
  const root = createRoot(mount as unknown as Element);
  root.render(createElement(FlowProvider, { flowKind: "lines", userId: "alice", baseUrl: BASE, fetcher, children: createElement(Screen) } as never));
  try {
    await until(() => (session !== undefined && !session.isLoading ? true : undefined), "the session to load");
    const first = await lines!.send("first turn");
    await until(() => (releaseTurn !== undefined && session!.isStreaming ? true : undefined), "the first turn to run and the view to follow it");
    const textOutcome = await lines!.send("go left instead");
    if (textOutcome !== "taken" || !steered.includes("go left instead")) {
      failures.push(`steer-live: a text line during the turn answered ${textOutcome}, steered ${JSON.stringify(steered)}: the steer path never took a line, so the file leg reads nothing`);
    }
    const fileOutcome = await lines!.send("and look at this", { attachments: [shot] });
    if (fileOutcome !== "after-this-turn") failures.push(`next-turn: the line with a file answered ${fileOutcome}, not after-this-turn`);
    if (steered.includes("and look at this")) failures.push("not-steered: the line with a file was steered into the running turn, so its file went nowhere");
    releaseTurn!();
    const turns = await until(async () => {
      const listed = await alice.client.sessions.requests(sessionId, { limit: 20 });
      const done = listed.filter((r) => r.actionName === "turn" && r.status === "completed");
      return done.length >= 2 ? done : undefined;
    }, "both turns to complete", 20_000).catch(() => undefined);
    if (turns === undefined) failures.push("next-turn: the line with a file never ran as a turn of its own");
    const snapshot = (await alice.client.sessions.state(sessionId, { includeItems: true, offset: 0, limit: 100 })) as { items?: Array<{ type: string; role?: string; requestId?: string; content?: Array<{ type: string; text?: string; data?: string }> }> };
    const userLines = (snapshot.items ?? []).filter((item) => item.type === "message" && item.role === "user");
    const fileLine = userLines.find((item) => (item.content ?? []).some((part) => part.type === "output_text" && part.text?.includes("and look at this")));
    const refs = (fileLine?.content ?? []).filter((part) => part.type === "file").map((part) => part.data);
    if (fileLine === undefined) failures.push(`next-turn: no user line holds "and look at this": ${userLines.length} user lines`);
    else if (!refs.includes(shot.data)) failures.push(`next-turn: the file line's turn holds ${JSON.stringify(refs)}, not the screenshot's reference`);
    else if (fileLine.requestId === first) failures.push("next-turn: the file line landed in the first turn's request");
    return {
      failures,
      evidence: `text line ${textOutcome} (steered ${steered.length}); file line ${fileOutcome}, ran as its own turn holding ${refs.length} reference(s)`,
    };
  } finally {
    root.unmount();
  }
}

/** Poll `read` until it answers, or throw after `ms`. */
async function until<T>(read: () => T | undefined | Promise<T | undefined>, what: string, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; ; ) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}
