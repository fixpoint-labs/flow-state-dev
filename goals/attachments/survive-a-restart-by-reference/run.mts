/**
 * Goal check, FIX-824 (the FIX-2516 kill line): a file sent to a running local
 * server comes back byte for byte after a restart, to the people who can read
 * its session and to no one else, while every session read carries only a
 * reference to it. See goal.md.
 *
 *   Server A: `host.mts`, a local server on on-disk SQLite that names no
 *             `blobs` slot, run in a scratch working directory. Alice uploads
 *             ten fresh PNGs and a PDF padded to 20 MB through the upload
 *             route, then sends one message naming all eleven into a session.
 *             The server is crashed (SIGKILL to its process group).
 *   Server B: a fresh process on the same store and folder. Through the read
 *             route only: each file's bytes hash-equal what was uploaded; the
 *             session read is small, holds the eleven references and no
 *             base64; Bob's read of each id is a 404.
 *   Repo:     no store adapter changed, no package gained a dependency.
 *
 * Controls (same command):
 *   `GOAL_CONTROL=memory-blobs`: the engine's default puts a durable
 *     profile's files in memory, as it would if blobs ignored where the
 *     sessions live. `reads` must fail.
 *   `GOAL_CONTROL=owner-blind`: the route guard stops comparing the caller
 *     with the session's owner, so a file is served to whoever names its id.
 *     `other-user` must fail.
 *
 * Run: pnpm tsx goals/attachments/survive-a-restart-by-reference/run.mts
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
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
if (!["", "memory-blobs", "owner-blind"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: memory-blobs, owner-blind`);

/** Files in memory whatever the sessions do: the default D1 rejected's opposite, for the control. */
const MEMORY_BLOBS: ModulePatch[] = [
  {
    module: "packages/engine/src/flowstate/resolve-slots.ts",
    from: "return storesPersist\\(stores\\)",
    to: "return false",
  },
];

/** The guard serves another user's session, and so its files: the check `other-user` exists for. */
const OWNER_BLIND: ModulePatch[] = [
  {
    module: "packages/engine/src/routes/route-auth.ts",
    from: "effective\\.kind === \"session\" && owner !== undefined && principal\\.userId !== owner",
    to: "false",
  },
  {
    module: "packages/engine/src/routes/route-auth.ts",
    from: "if \\(owner !== undefined && principal\\.userId !== owner\\)",
    to: "if (false)",
  },
];
const PATCHES = CONTROL === "memory-blobs" ? MEMORY_BLOBS : CONTROL === "owner-blind" ? OWNER_BLIND : [];

const PORT = 4_000 + Math.floor(Math.random() * 1_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SCRATCH = goalTmpDir("survive-a-restart-by-reference");
const DB = join(SCRATCH, "store.sqlite");
const MARK = join(SCRATCH, "patched.txt");
const HOST = join(REPO_ROOT, "goals", "attachments", "survive-a-restart-by-reference", "host.mts");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const PDF_BYTES = 20 * 1024 * 1024;
const SESSION_READ_LIMIT = 20 * 1024;

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

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A fresh PNG-shaped file: the signature, then random bytes, so no two runs share one. */
function freshPng(): Uint8Array {
  const body = randomBytes(64 * 1024 + Math.floor(Math.random() * 64 * 1024));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), body]));
}

/** A PDF padded to exactly 20 MB with random bytes. */
function freshPdf(): Uint8Array {
  const head = Buffer.from(`%PDF-1.7\n% goal ${Date.now()}\n`);
  return new Uint8Array(Buffer.concat([head, randomBytes(PDF_BYTES - head.byteLength)]));
}

/** The repo-side "not done if" lines: no store adapter changed, no dependency added. */
function repoFailures(): string[] {
  const failures: string[] = [];
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const untouched = ["packages/store-sqlite", "packages/store-postgres", "packages/engine/src/stores/filesystem", "packages/engine/src/stores/memory"];
  const changed = execFileSync("git", ["diff", "--name-only", base, "--", ...untouched], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  if (changed !== "") failures.push(`repo: store adapters changed: ${changed.split("\n").join(", ")}`);
  const manifests = execFileSync("git", ["diff", "--name-only", base, "--", "packages/*/package.json"], { cwd: REPO_ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const manifest of manifests) {
    const read = (ref: string | undefined): Record<string, string> => {
      try {
        const text = ref === undefined
          ? execFileSync("cat", [manifest], { cwd: REPO_ROOT, encoding: "utf8" })
          : execFileSync("git", ["show", `${ref}:${manifest}`], { cwd: REPO_ROOT, encoding: "utf8" });
        return (JSON.parse(text) as { dependencies?: Record<string, string> }).dependencies ?? {};
      } catch {
        return {};
      }
    };
    const before = read(base);
    const added = Object.keys(read(undefined)).filter((name) => !(name in before));
    if (added.length > 0) failures.push(`repo: ${manifest} gained dependencies: ${added.join(", ")}`);
  }
  return failures;
}

let host: ChildProcess | undefined;
await runGoal(async (failures, tell) => {
  try {
    if (CONTROL !== "") console.error(`control ${CONTROL}:\n${describePatches(PATCHES, REPO_ROOT)}`);

    // --- Server A: upload eleven files, send them in one message -------------
    host = await startHost();
    const alice = createClient({ userId: "alice", baseUrl: ORIGIN, fetcher: as("alice") });
    const files = [
      ...Array.from({ length: 10 }, (_, i) => ({ bytes: freshPng(), mediaType: "image/png", filename: `shot-${i + 1}.png` })),
      { bytes: freshPdf(), mediaType: "application/pdf", filename: "report.pdf" },
    ];
    const uploaded = [];
    for (const f of files) {
      uploaded.push({ ...f, attachment: await alice.upload({ data: f.bytes, mediaType: f.mediaType, filename: f.filename }) });
    }
    const session = await alice.flow("chat").createSession();
    const attachments = uploaded.map((u) => u.attachment);
    // By hand, as the spec's client example does: the reference list beside the input.
    const sent = await fetch(`${ORIGIN}/api/flows/chat/${session.id}/actions/send`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "alice" },
      body: JSON.stringify({ input: { message: "here are the files", files: attachments }, attachments }),
    });
    if (sent.status !== 202) throw new Error(`setup: the send answered ${sent.status}: ${await sent.text()}`);
    const requestId = ((await sent.json()) as { request: { id: string } }).request.id;
    const ended = await alice.flow("chat").request(requestId).wait({ timeoutMs: 30_000 });
    if (ended.status !== "completed") throw new Error(`setup: the send ended ${ended.status}`);

    // --- The crash, and Server B on the same store and folder ----------------
    host = await crashAndRestart(host, startHost);

    // reads: every file, through the read route, as its session's owner.
    const ids = tell.over("reads · the eleven references", uploaded.map((u) => parseBlobRef(u.attachment.data)).filter((id): id is string => id !== undefined));
    let matched = 0;
    for (const [index, id] of ids.entries()) {
      const read = await fetch(`${ORIGIN}/api/flows/blobs/${id}`, { headers: { "x-user": "alice" } });
      if (read.status !== 200) {
        failures.push(`reads: ${uploaded[index]!.filename} answered ${read.status} after the restart`);
        continue;
      }
      const got = sha(new Uint8Array(await read.arrayBuffer()));
      if (got !== sha(uploaded[index]!.bytes)) failures.push(`reads: ${uploaded[index]!.filename} came back different (sha256 ${got.slice(0, 12)}…)`);
      else matched += 1;
    }
    if (ids.length !== 11) failures.push(`reads: ${ids.length} references to read, expected 11`);

    // session-read: what a reload reads, measured as it crosses the wire.
    const sessionRead =
      (await (await fetch(`${ORIGIN}/api/flows/sessions/${session.id}`, { headers: { "x-user": "alice" } })).text()) +
      (await (await fetch(`${ORIGIN}/api/flows/sessions/${session.id}/requests`, { headers: { "x-user": "alice" } })).text());
    const refsInRead = new Set(tell.over("session-read · references in it", ids.filter((id) => sessionRead.includes(id))));
    const base64Runs = sessionRead.match(/[A-Za-z0-9+/=]{1024,}/g) ?? [];
    if (sessionRead.length >= SESSION_READ_LIMIT) failures.push(`session-read: ${sessionRead.length} bytes, expected under ${SESSION_READ_LIMIT}`);
    if (refsInRead.size !== 11) failures.push(`session-read: holds ${refsInRead.size} of the 11 references`);
    if (base64Runs.length > 0) failures.push(`session-read: holds ${base64Runs.length} base64 run(s) over 1 KB`);

    // other-user: Bob, signed in, reads each id and is told there is no such file.
    const bobStatuses = tell.over(
      "other-user · Bob's reads",
      await Promise.all(ids.map(async (id) => (await fetch(`${ORIGIN}/api/flows/blobs/${id}`, { headers: { "x-user": "bob" } })).status)),
    );
    const served = bobStatuses.filter((status) => status !== 404);
    if (served.length > 0) failures.push(`other-user: Bob's reads answered ${JSON.stringify(bobStatuses)}, expected all 404`);

    // repo: the kill line's "no new dependency, no store adapter changed".
    failures.push(...repoFailures());

    if (CONTROL !== "") assertPatched(PATCHES, REPO_ROOT, MARK);
    return {
      failures,
      evidence:
        `crashed and restarted on the same SQLite store; ${matched}/11 files read back sha256-equal through the read route ` +
        `(10 PNGs, a ${PDF_BYTES}-byte PDF); session read ${sessionRead.length} bytes with ${refsInRead.size} references and no base64 run; ` +
        `Bob's 11 reads all 404; no store adapter changed, no dependency added`,
    };
  } finally {
    stopProcessGroup(host, "SIGKILL");
    rmSync(SCRATCH, { recursive: true, force: true });
  }
});
