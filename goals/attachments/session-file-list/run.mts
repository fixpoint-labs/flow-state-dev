/**
 * Goal check, FIX-2634: a flow that includes the attachments block gets, with
 * no other wiring, a list of every file its session's turns sent, kept through
 * a restart, holding references and no bytes, and deleted with the session. A
 * flow without the block keeps its files. See goal.md.
 *
 *   Server A: `host.mts`, a local server on on-disk SQLite hosting the same
 *             chat with the block (`with-block`) and without it
 *             (`without-block`). Alice uploads two fresh PNGs and a small PDF
 *             per flow and sends them over two turns of each. The server is
 *             crashed (SIGKILL to its process group).
 *   Server B: a fresh process on the same store. Through the client only:
 *             `with-block`'s list holds the three references sent, with their
 *             names, types and requests, small and with no base64;
 *             `without-block` has no list and its three files read 200. Then
 *             `with-block`'s session is deleted: its list is empty and its
 *             files read 404.
 *
 * Control (same command):
 *   `GOAL_CONTROL=skip-record`: the block writes nothing. `list` must fail.
 *
 * Run: pnpm tsx goals/attachments/session-file-list/run.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type ClientFetch } from "@flow-state-dev/client";
import { ATTACHMENTS, parseBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import {
  REPO_ROOT,
  assertPatched,
  crashAndRestart,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  refuseIfAnswering,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!["", "skip-record"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: skip-record`);

/** The block runs, declares its list, and records none of the turn's files. */
const SKIP_RECORD: ModulePatch[] = [
  {
    module: "packages/core/src/helpers/record-attachments.ts",
    from: "for \\(const file of ctx\\.request\\.attachments\\)",
    to: "for (const file of [] as typeof ctx.request.attachments)",
  },
];
const PATCHES = CONTROL === "skip-record" ? SKIP_RECORD : [];

const PORT = 5_000 + Math.floor(Math.random() * 1_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SCRATCH = goalTmpDir("session-file-list");
const DB = join(SCRATCH, "store.sqlite");
const MARK = join(SCRATCH, "patched.txt");
const HOST = join(REPO_ROOT, "goals", "attachments", "session-file-list", "host.mts");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const LIST_LIMIT = 5 * 1024;
const BASE64_RUN = /[A-Za-z0-9+/=]{1024,}/g;

/** Start the server in the scratch folder, on the shared store, and wait for it to answer. */
async function startHost(): Promise<ChildProcess> {
  await refuseIfAnswering(ORIGIN);
  const control = PATCHES.length > 0 ? modulePatchEnv(PATCHES, REPO_ROOT, MARK) : {};
  // The working directory is the scratch folder, so the default `.fsdev/blobs` lands there.
  const child = spawn(TSX, [HOST], {
    cwd: SCRATCH,
    env: { ...process.env, ...control, PORT: String(PORT), GOAL_DB: DB },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${ORIGIN}/healthz`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopProcessGroup(child, "SIGKILL");
  throw new Error("the host never answered /healthz");
}

/** A fetch as `user`: the host reads who is asking from `x-user`. */
const as =
  (user: string): ClientFetch =>
  (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("x-user", user);
    return fetch(input, { ...init, headers });
  };

/** A fresh PNG-shaped file: the signature, then random bytes, so no two runs share one. */
const freshPng = (): Uint8Array =>
  new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(16 * 1024 + Math.floor(Math.random() * 16 * 1024))]));

/** A small PDF-shaped file with random bytes after the header. */
const freshPdf = (): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from(`%PDF-1.7\n% goal ${Date.now()}\n`), randomBytes(32 * 1024)]));

type Sent = { file: FileContent; requestId: string };

/** Upload two PNGs and a PDF to `flow`, send the PNGs in one turn and the PDF in the next. */
async function sendTwoTurns(client: Client, flow: string): Promise<{ sessionId: string; sent: Sent[] }> {
  const handle = client.flow(flow);
  const sessionId = (await handle.createSession()).id;
  const pngs = [
    await handle.upload({ data: freshPng(), mediaType: "image/png", filename: "first.png" }),
    await handle.upload({ data: freshPng(), mediaType: "image/png", filename: "second.png" }),
  ];
  const pdf = await handle.upload({ data: freshPdf(), mediaType: "application/pdf", filename: "notes.pdf" });
  const sent: Sent[] = [];
  for (const [message, files] of [["two screenshots", pngs], ["and the notes", [pdf]]] as const) {
    const request = await handle.send("send", { message }, { sessionId, attachments: [...files] });
    const { status } = await request.wait({ pollMs: 100, timeoutMs: 30_000 });
    if (status !== "completed") throw new Error(`setup: ${flow} "${message}" ended ${status}`);
    for (const file of files) sent.push({ file, requestId: request.id });
  }
  return { sessionId, sent };
}

/** The session's list through the client's collection route; a session with none reads as empty. */
async function listOf(client: Client, sessionId: string): Promise<{ wire: string; entries: Array<Record<string, unknown>> }> {
  try {
    const page = await client.resources.listCollectionResources(sessionId, ATTACHMENTS, { limit: 100 });
    return { wire: JSON.stringify(page), entries: page.items.map((item) => ({ topic: item.topic, ...(item.clientData as Record<string, unknown>) })) };
  } catch (err) {
    if (/\b404\b/.test(String(err))) return { wire: "", entries: [] };
    throw err;
  }
}

const readStatus = async (user: string, file: FileContent): Promise<number> =>
  (await fetch(`${ORIGIN}/api/flows/blobs/${parseBlobRef(file.data)}`, { headers: { "x-user": user } })).status;

let host: ChildProcess | undefined;
await runGoal(async (failures, tell) => {
  try {
    if (CONTROL !== "") console.error(`control ${CONTROL}:\n${describePatches(PATCHES, REPO_ROOT)}`);

    // --- Server A: two turns of files into each flow --------------------------
    host = await startHost();
    const alice = createClient({ userId: "alice", baseUrl: ORIGIN, fetcher: as("alice") });
    const a = await sendTwoTurns(alice, "with-block");
    const b = await sendTwoTurns(alice, "without-block");

    // --- The crash, and Server B on the same store ----------------------------
    host = await crashAndRestart(host, startHost);
    const reader = createClient({ userId: "alice", baseUrl: ORIGIN, fetcher: as("alice") });

    // list: three entries, one per file sent, with its name, type and turn.
    const listed = await listOf(reader, a.sessionId);
    const entries = tell.over("list · with-block's entries after the restart", listed.entries);
    if (entries.length !== 3) failures.push(`list: ${entries.length} entries after the restart, expected 3`);
    for (const { file, requestId } of a.sent) {
      const entry = entries.find((e) => e.ref === file.data);
      if (entry === undefined) {
        failures.push(`list: no entry for ${file.filename}`);
        continue;
      }
      const want = { topic: parseBlobRef(file.data), filename: file.filename, mediaType: file.mediaType, requestId };
      const got = { topic: entry.topic, filename: entry.filename, mediaType: entry.mediaType, requestId: entry.requestId };
      if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`list: ${file.filename} reads ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }

    // size: references, not bytes.
    const base64Runs = listed.wire.match(BASE64_RUN) ?? [];
    if (listed.wire.length >= LIST_LIMIT) failures.push(`size: the list is ${listed.wire.length} bytes, expected under ${LIST_LIMIT}`);
    if (base64Runs.length > 0) failures.push(`size: the list holds ${base64Runs.length} base64 run(s) over 1 KB`);

    // without: the same flow without the block has no list and still serves its files.
    const declaredIn = async (sessionId: string) =>
      (await reader.resources.getResourceManifest(sessionId)).resources.filter(
        (r) => r.ref === ATTACHMENTS || (r as { pattern?: string }).pattern === `${ATTACHMENTS}/*`,
      );
    // The manifest read can see the list at all: with-block's names it.
    if ((await declaredIn(a.sessionId)).length !== 1) failures.push("without: with-block's manifest does not name the list, so its absence below shows nothing");
    const declared = await declaredIn(b.sessionId);
    if (declared.length > 0) failures.push(`without: without-block declares ${JSON.stringify(declared)}`);
    const bReads = tell.over("without · without-block's reads", await Promise.all(b.sent.map(({ file }) => readStatus("alice", file))));
    if (bReads.length !== 3 || bReads.some((status) => status !== 200)) failures.push(`without: reads answered ${JSON.stringify(bReads)}, expected 3 × 200`);

    // delete: the list goes with the session, as the files do.
    await reader.sessions.delete(a.sessionId);
    const after = await listOf(reader, a.sessionId);
    if (after.entries.length > 0) failures.push(`delete: ${after.entries.length} entries left after the session delete`);
    const aReads = tell.over("delete · with-block's reads after the delete", await Promise.all(a.sent.map(({ file }) => readStatus("alice", file))));
    if (aReads.some((status) => status !== 404)) failures.push(`delete: reads answered ${JSON.stringify(aReads)}, expected all 404`);

    if (CONTROL !== "") assertPatched(PATCHES, REPO_ROOT, MARK);
    return {
      failures,
      evidence:
        `SIGKILL and restart on the same SQLite store; with-block lists ${entries.length} entries (${listed.wire.length} bytes, ` +
        `${base64Runs.length} base64 runs); without-block declares no list, reads ${JSON.stringify(bReads)}; ` +
        `after the session delete ${after.entries.length} entries, reads ${JSON.stringify(aReads)}`,
    };
  } finally {
    stopProcessGroup(host, "SIGKILL");
    rmSync(SCRATCH, { recursive: true, force: true });
  }
});
