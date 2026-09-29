/**
 * A run-scoped workspace belongs to one request, never to a request id.
 *
 * The bash tool's `scope: "run"` workspace on the local provider is a
 * directory on disk, one per request, shared by that request's blocks. A
 * request id is the caller's to choose and is not a secret, so another user in
 * the same tenant can learn one from a 202 and send it on their own call. What
 * that must get them is an empty workspace of their own, whether the first
 * user's request is still on record or session retention has already deleted
 * it. The directory is not deleted with the record, so the second case is the
 * one a key on the id alone gets wrong.
 *
 * Every assertion reads what Bob's OWN command printed. His command tags its
 * output (`BOB_SAW:`), so an item of Alice's that a replay happened to carry
 * can never pass for his run reading her file.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createBashBlocks, releaseBashSandbox } from "@flow-state-dev/tools/bash";
import { z } from "zod";
import { startTwoUserServer, waitFor, type TwoUserServer } from "./harness";

const provider = { type: "local", scope: "run" } as const;
const { bashCommand } = createBashBlocks({ provider });

const SECRET = "alice-secret-7f3a";
/** Alice writes her note and reads it back, so her run provably wrote it. */
const ALICE_WRITES = `echo ${SECRET} > note.txt && cat note.txt`;
/** Alice, retrying her own request, reads what her first attempt left. */
const ALICE_READS = "printf ALICE_SAW: && (cat note.txt 2>/dev/null || echo NO_FILE)";
/** Bob reads whatever is there, then leaves a note of his own over it. */
const BOB_READS = "printf BOB_SAW: && (cat note.txt 2>/dev/null || echo NO_FILE) && echo bob > note.txt";

const scratch = defineFlow({
  kind: "scratch",
  // Evict every completed request older than 1ms when the next one in the
  // session completes: the smallest retention that frees an id.
  session: { retention: { maxAge: "1ms" } },
  // The documented cleanup wiring: release the sandbox when the request ends.
  // It drops the in-process sandbox, not the directory.
  request: {
    onFinished: handler({
      name: "scratch-release",
      execute: async (_input, ctx) => {
        await releaseBashSandbox(provider, ctx);
      }
    })
  },
  actions: {
    run: {
      inputSchema: z.object({ command: z.string() }),
      block: bashCommand
    }
  }
});

let server: TwoUserServer;
let home: string;
let cwd: string;

beforeEach(async () => {
  home = process.cwd();
  // A directory per case, so one case's files never count in another's.
  cwd = await mkdtemp(join(tmpdir(), "fsd-run-workspace-"));
  process.chdir(cwd); // run workspaces land under `.fsdev/workspaces/` here
  server = await startTwoUserServer([scratch()]);
});

afterEach(async () => {
  await server.close();
  process.chdir(home);
  await rm(cwd, { recursive: true, force: true });
});

type Caller = ReturnType<TwoUserServer["as"]>;

/**
 * Run `command` as `caller`, wait for it to settle, and return its id and
 * replay. With `until`, also wait for the replay to carry that text: a retry
 * of a request already on record reads "completed" from its first attempt
 * until the retry's own items land.
 */
async function run(
  caller: Caller,
  sessionId: string,
  command: string,
  requestId?: string,
  until?: string
) {
  const response = await caller(`/scratch/${sessionId}/actions/run`, {
    method: "POST",
    body: JSON.stringify({ input: { command }, ...(requestId === undefined ? {} : { requestId }) })
  });
  expect(response.status).toBe(202);
  const { request } = (await response.json()) as { request: { id: string } };
  const status = await waitFor(async () => {
    const res = await caller(`/scratch/requests/${request.id}/status`);
    if (res.status !== 200) return undefined;
    const body = (await res.json()) as { status: string };
    return body.status === "in_progress" ? undefined : body.status;
  }, `request ${request.id} to settle`);
  expect(status).toBe("completed");
  const text = await waitFor(async () => {
    const stream = await caller(`/scratch/requests/${request.id}/stream`);
    const body = await stream.text();
    return until === undefined || body.includes(until) ? body : undefined;
  }, `request ${request.id} to show ${until ?? "its replay"}`);
  return { id: request.id, text };
}

/** Every file under the run workspaces' root whose content is exactly `text`. */
async function filesHolding(text: string): Promise<string[]> {
  const root = join(cwd, ".fsdev", "workspaces", "run");
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const hits: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    if ((await readFile(file, "utf8")).trim() === text) hits.push(file);
  }
  return hits;
}

describe("a run workspace, when another user sends the same request id", () => {
  it("while the first request is on record: Bob gets his own request and an empty workspace", async () => {
    const alice = server.as("alice");
    const bob = server.as("bob");

    const a = await run(alice, "s_alice", ALICE_WRITES);
    expect(a.text).toContain(SECRET); // Alice's run really wrote it

    const b = await run(bob, "s_bob", BOB_READS, a.id, "BOB_SAW:");
    expect(b.id).not.toBe(a.id);
    expect(b.text).toContain("BOB_SAW:NO_FILE");
    expect(b.text).not.toContain(`BOB_SAW:${SECRET}`);

    // Alice retrying her own request, still on record, is the same request
    // and finds the file her first attempt left.
    const again = await run(alice, "s_alice", ALICE_READS, a.id, "ALICE_SAW:");
    expect(again.id).toBe(a.id);
    expect(again.text).toContain(`ALICE_SAW:${SECRET}`);

    expect(await filesHolding(SECRET)).toHaveLength(1);
  });

  it("after retention deleted the first request: Bob runs under that id and still sees an empty workspace", async () => {
    const alice = server.as("alice");
    const bob = server.as("bob");

    const a = await run(alice, "s_alice", ALICE_WRITES);
    expect(a.text).toContain(SECRET);

    // Real retention, over HTTP: each later request Alice completes in her
    // session evicts her older completed ones. Poll until her first id is
    // gone rather than trusting a sleep. Her record goes; her directory stays.
    await waitFor(async () => {
      await run(alice, "s_alice", "true");
      const status = await alice(`/scratch/requests/${a.id}/status`);
      return status.status === 404 ? true : undefined;
    }, `retention to delete ${a.id}`);

    const b = await run(bob, "s_bob", BOB_READS, a.id, "BOB_SAW:");
    // The id is free, so Bob's request really is under Alice's old id: the
    // case asks the key, not the owner check in front of it.
    expect(b.id).toBe(a.id);
    expect(b.text).toContain("BOB_SAW:NO_FILE");
    expect(b.text).not.toContain(`BOB_SAW:${SECRET}`);

    // Bob's write landed in his own workspace: Alice's note is intact.
    expect(await filesHolding(SECRET)).toHaveLength(1);
  });
});
