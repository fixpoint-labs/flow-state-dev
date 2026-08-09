/**
 * The CLI session mint path fences its record (FIX-1000).
 *
 * `fsdev run --session <id> --seed-session <json>` creates a session record
 * when none exists. `SessionRecord.storageGeneration` is optional, so a mint
 * site that forgets it compiles and passes every existing test while silently
 * leaving its sessions unfenced. One test per mint path is the substitute for
 * the compiler; the siblings are
 * `packages/engine/test/session-generation-mint-paths.test.ts` and
 * `packages/chat-sdk/test/session-generation-mint.test.ts`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { createInMemoryStores, resolveSessionResourceScopeId } from "@flow-state-dev/engine";
import { executeRunCommand } from "../src/commands/run";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

// `executeRunCommand` streams NDJSON to stdout; swallow it so the test output
// stays readable. Same shape as `run-command.integration.test.ts`.
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

beforeEach(() => {
  process.stdout.write = vi.fn(() => true) as never;
  process.stderr.write = vi.fn(() => true) as never;
  process.exitCode = undefined;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  process.exitCode = undefined;
});

describe("FIX-1000: fsdev run's session seed", () => {
  it("mints a storage generation that moves the resource address off the record key", async () => {
    const stores = createInMemoryStores();

    await executeRunCommand("echo", "respond", {
      input: '{"message": "hello"}',
      cwd: fixturesDir,
      stores,
      session: "cli_sess_1",
      seedSession: '{"seeded": true}',
    });

    const record = await stores.session.get("cli_sess_1");
    expect(record).toBeDefined();
    expect(typeof record!.storageGeneration).toBe("string");
    expect(record!.storageGeneration!.length).toBeGreaterThan(0);
    // A generation that resolved back to the bare id would satisfy the checks
    // above and fence nothing — this is the clause with teeth.
    expect(resolveSessionResourceScopeId(record!)).not.toBe(record!.id);
  });

  it("re-seeding an existing session keeps its generation, so the address is stable", async () => {
    // The seed path branches on existence; the update branch spreads the
    // existing record, which must carry the generation through. A branch that
    // rebuilt the record from scratch would silently re-address the session
    // between two `fsdev run` invocations.
    const stores = createInMemoryStores();

    await executeRunCommand("echo", "respond", {
      input: '{"message": "hello"}',
      cwd: fixturesDir,
      stores,
      session: "cli_sess_2",
      seedSession: '{"seeded": true}',
    });
    const first = (await stores.session.get("cli_sess_2"))!.storageGeneration;

    await executeRunCommand("echo", "respond", {
      input: '{"message": "again"}',
      cwd: fixturesDir,
      stores,
      session: "cli_sess_2",
      seedSession: '{"seeded": false}',
    });
    const second = (await stores.session.get("cli_sess_2"))!.storageGeneration;

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });
});
