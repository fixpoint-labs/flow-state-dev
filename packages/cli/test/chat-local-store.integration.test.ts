/**
 * What a no-config `fsdev chat` does with a turn that stops for a person.
 *
 * Why this matters: `fsdev run` and `fsdev dev` keep durable execution on over
 * the shared `.fsdev/data/fsdev.db`, so a stop is held there and answered in
 * the DevTool. A chat turn over the same file must hold the same stop, as the
 * same user, and say where to answer it — not refuse it. Every check reads the
 * store the turn wrote, not the transcript alone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { createInMemoryStores, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { DEFAULT_LOCAL_USER_ID } from "@flow-state-dev/core";
import { executeChatCommand } from "../src/commands/chat";

const fixtureDir = resolve(import.meta.dirname, "fixtures", "chat-durable");

let workDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "fsdev-chat-local-"));
  process.chdir(workDir);
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

/** One piped chat session over the fixture; returns the transcript. */
async function chat(script: string, stores?: StoreRegistry): Promise<string> {
  let text = "";
  const output = new Writable({
    write(chunk, _enc, cb) {
      text += chunk.toString();
      cb();
    },
  });
  await executeChatCommand("approval", "chat", {
    cwd: fixtureDir,
    stores,
    input: Readable.from([script]) as unknown as NodeJS.ReadableStream,
    output: output as unknown as NodeJS.WritableStream,
  });
  return text;
}

describe("no-config fsdev chat: a stop held in the shared local database", () => {
  it("holds the turn's stop in fsdev dev's SQLite file, as the DevTool's user, and says where to answer it", async () => {
    const transcript = await chat("ship it\n/exit\n");

    const stores = createSQLiteStores({ filename: join(workDir, ".fsdev/data/fsdev.db") });
    try {
      const requests = await stores.request.list({});
      expect(requests.map((r) => r.status)).toEqual(["suspended"]);
      expect(requests[0]?.userId).toBe(DEFAULT_LOCAL_USER_ID);
      const stops = await stores.suspensions.list({});
      expect(stops.map((s) => [s.requestId, s.status])).toEqual([[requests[0]!.id, "pending"]]);

      // One notice: what waits, its id, and where to answer it.
      expect(transcript).toContain('Send "ship it"?');
      expect(transcript).toContain(stops[0]!.suspensionId);
      expect(transcript).toContain("fsdev dev");
      expect(transcript).not.toMatch(/durable execution/);
    } finally {
      stores.close();
    }
    // A held turn is not a failed one.
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("OFF STATE: on injected in-memory stores the stop is still refused, naming the setting", async () => {
    const stores = createInMemoryStores();
    const transcript = await chat("ship it\n/exit\n", stores);

    expect(transcript).toMatch(/durable execution/);
    expect(await stores.suspensions.list({})).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});
