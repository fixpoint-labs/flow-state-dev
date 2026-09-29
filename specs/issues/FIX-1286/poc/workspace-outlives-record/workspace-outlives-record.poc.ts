/**
 * FIX-1286 POC · does binding a request id to its owner (FIX-1018) keep two
 * users apart in a run-scoped workspace?
 *
 * Retained design evidence, not production code and not the regression case.
 * Runs on FIX-1018's head (PR #2377) until that merges, then on `main`.
 *
 * The premise under test (epic D3, and the Architect's call on the issue):
 * once no user can adopt another user's request record, two users with one
 * request id already have two requests, so the workspace keyed on
 * `[tenant, requestId]` needs no change. Two runs, over real HTTP, as two
 * users in one tenant:
 *
 *  1. LIVE — Alice's request record still exists when Bob reuses its id.
 *  2. EVICTED — session retention has deleted Alice's record first, so the id
 *     is free when Bob sends it. The workspace directory is not deleted with
 *     the record.
 *
 * Each run asks for Alice's file the way an attacker would: Bob learns her
 * request id from her 202 and sends it as his own `requestId`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createBashBlocks, releaseBashSandbox } from "@flow-state-dev/tools/bash";
import { z } from "zod";
import {
  startTwoUserServer,
  waitFor,
  type TwoUserServer
} from "../../../../../packages/integration-tests/src/two-users-one-tenant/harness";

const provider = { type: "local", scope: "run" } as const;
const { bashCommand } = createBashBlocks({ provider });

const SECRET = "alice-secret-7f3a";
/**
 * Bob's command tags its own output, so a hit is his run reading the file,
 * never an item of Alice's that a replay happened to carry.
 */
const BOB_READS = "printf BOB_SAW: && (cat note.txt 2>/dev/null || echo NO_FILE)";
const BOB_SAW_SECRET = `BOB_SAW:${SECRET}`;

const scratch = defineFlow({
  kind: "scratch",
  // Evict every completed request older than 1ms when the next one in the
  // session completes: the smallest retention that frees an id.
  session: { retention: { maxAge: "1ms" } },
  // The documented cleanup wiring: release the sandbox when the request ends.
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
let cwd: string;
let home: string;

beforeAll(async () => {
  home = process.cwd();
  cwd = await mkdtemp(join(tmpdir(), "fix-1286-poc-"));
  process.chdir(cwd); // `.fsdev/workspaces/run/...` lands here
});

afterAll(async () => {
  process.chdir(home);
  await rm(cwd, { recursive: true, force: true });
});

beforeEach(async () => {
  server = await startTwoUserServer([scratch()]);
});

afterEach(async () => {
  await server.close();
});

type Caller = ReturnType<TwoUserServer["as"]>;

async function run(caller: Caller, sessionId: string, command: string, requestId?: string) {
  const response = await caller(`/scratch/${sessionId}/actions/run`, {
    method: "POST",
    body: JSON.stringify({ input: { command }, ...(requestId === undefined ? {} : { requestId }) })
  });
  expect(response.status).toBe(202);
  const { request } = (await response.json()) as { request: { id: string } };
  await waitFor(async () => {
    const status = await caller(`/scratch/requests/${request.id}/status`);
    if (status.status !== 200) return undefined;
    const body = (await status.json()) as { status: string };
    return body.status === "in_progress" ? undefined : body.status;
  }, `request ${request.id} to settle`);
  const stream = await caller(`/scratch/requests/${request.id}/stream`);
  return { id: request.id, text: await stream.text() };
}

describe("FIX-1286 · Bob reuses Alice's request id in a run-scoped workspace", () => {
  it("LIVE: Alice's record exists, so Bob gets his own request and an empty workspace", async () => {
    const alice = server.as("alice");
    const bob = server.as("bob");

    const a = await run(alice, "s_alice", `echo ${SECRET} > note.txt && cat note.txt`);
    expect(a.text).toContain(SECRET); // Alice's run really wrote it

    const b = await run(bob, "s_bob", BOB_READS, a.id);
    console.log(`[LIVE] alice=${a.id} bob=${b.id} bob-read-secret=${b.text.includes(BOB_SAW_SECRET)} bob-ran=${b.text.includes("BOB_SAW:")}`);
    expect(b.id).not.toBe(a.id);
    expect(b.text).toContain("BOB_SAW:NO_FILE");
    expect(b.text).not.toContain(BOB_SAW_SECRET);
  });

  it("EVICTED: retention deleted Alice's record, so Bob runs under her id and reads her file", async () => {
    const alice = server.as("alice");
    const bob = server.as("bob");

    const a = await run(alice, "s_alice", `echo ${SECRET} > note.txt && cat note.txt`);
    expect(a.text).toContain(SECRET);
    await new Promise((r) => setTimeout(r, 20));
    // Alice's next request in the same session completes, and retention
    // evicts her first one. Her record is gone; her directory is not.
    await run(alice, "s_alice", "true");
    const gone = await alice(`/scratch/requests/${a.id}/status`);
    console.log(`[EVICTED] alice's first record after retention: HTTP ${gone.status}`);
    expect(gone.status).toBe(404);

    const b = await run(bob, "s_bob", BOB_READS, a.id);
    const leaked = b.text.includes(BOB_SAW_SECRET);
    if (process.env.POC_DEBUG) console.log(b.text);
    console.log(`[EVICTED] alice=${a.id} bob=${b.id} same-id=${b.id === a.id} bob-read-secret=${leaked} replay-carries-alice-item=${b.text.replaceAll(BOB_SAW_SECRET, "").includes(SECRET)}`);
    // What the POC records, not what the fix should do: the residual FIX-1286
    // must close. The regression case asserts the opposite.
    expect(b.id).toBe(a.id);
    expect(leaked).toBe(true);
  });
});
