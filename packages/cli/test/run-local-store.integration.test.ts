/**
 * Where a no-config `fsdev run` keeps its work, and what it does with a stop
 * (FIX-2063 D1, D3).
 *
 * Why these matter: a stop a terminal run makes is answered after the command
 * exits, and the one local host that answers is `fsdev dev`. So the run writes
 * to the database `fsdev dev` reads, as the user the DevTool lists sessions
 * for, holds the stop instead of failing on it, and says where to answer it.
 * Every check reads the store the run wrote, not the run's own report alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFilesystemStores, createInMemoryStores, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { DEFAULT_LOCAL_USER_ID } from "@flow-state-dev/core";
import { executeRunCommand } from "../src/commands/run";
import { CliError } from "../src/resolve-block";
import { EXIT_INVALID_ARGS } from "../src/exit-codes";

const fixtureDir = resolve(import.meta.dirname, "fixtures", "durable");
const configDir = resolve(import.meta.dirname, "fixtures-config", "app");

let workDir: string;
let originalCwd: string;
let stdoutLines: string[];
let stderrText: string;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "fsdev-run-local-"));
  process.chdir(workDir);
  stdoutLines = [];
  stderrText = "";
  process.stdout.write = vi.fn((chunk: any) => {
    for (const line of String(chunk).split("\n")) if (line.trim().length > 0) stdoutLines.push(line);
    return true;
  }) as any;
  process.stderr.write = vi.fn((chunk: any) => {
    stderrText += String(chunk);
    return true;
  }) as any;
  process.exitCode = undefined;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  process.exitCode = undefined;
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

const events = () => stdoutLines.map((line) => JSON.parse(line) as { type: string; [key: string]: unknown });

/** Read the run's request and its pending stops from `stores`, then close them. */
async function readBack(stores: StoreRegistry & { close?: () => void }, requestId: string) {
  try {
    const request = await stores.request.get(requestId);
    const stops = (await stores.suspensions.list({})).filter((s) => s.requestId === requestId);
    return { request, stops };
  } finally {
    stores.close?.();
  }
}

describe("no-config fsdev run: one local database, a stop held and reported", () => {
  it("holds the stop in fsdev dev's SQLite file, as the DevTool's user, exits 0 and says where to answer it", async () => {
    const capture = join(workDir, "run.json");
    const result = await executeRunCommand("review", "submit", {
      cwd: fixtureDir,
      input: '{"title":"Q3 notes"}',
      capture,
    });

    expect(process.exitCode).toBe(0);
    expect(result.success).toBe(true);
    const waiting = result.suspended;
    expect(waiting?.suspensionId).toMatch(/^susp/);
    expect(waiting?.message).toBe('Publish "Q3 notes"?');

    // The stop is in the file `fsdev dev` serves, under the user it lists for.
    expect(existsSync(join(workDir, ".fsdev/data/fsdev.db"))).toBe(true);
    const { request, stops } = await readBack(
      createSQLiteStores({ filename: join(workDir, ".fsdev/data/fsdev.db") }),
      waiting!.requestId,
    );
    expect(request?.status).toBe("suspended");
    expect(request?.userId).toBe(DEFAULT_LOCAL_USER_ID);
    expect(stops.map((s) => [s.suspensionId, s.status])).toEqual([[waiting!.suspensionId, "pending"]]);

    // Reported on every surface a caller reads: the NDJSON stream, the capture, stderr.
    const terminal = events().at(-1);
    expect(terminal).toMatchObject({ type: "suspended", suspensionId: waiting!.suspensionId, requestId: waiting!.requestId });
    expect(events().some((e) => e.type === "flow_complete")).toBe(false);
    const captured = JSON.parse(readFileSync(capture, "utf-8"));
    expect(captured.result.suspended).toMatchObject({ suspensionId: waiting!.suspensionId, requestId: waiting!.requestId });
    expect(captured.result.exitCode).toBe(0);
    expect(stderrText).toContain(waiting!.suspensionId);
    expect(stderrText).toContain("fsdev dev");
    expect(stderrText).toMatch(/deadline fires only while a server runs on this store/);
  });

  it("--store filesystem keeps the run's state as JSON files under .fsdev/data, and still holds the stop", async () => {
    const result = await executeRunCommand("review", "submit", {
      cwd: fixtureDir,
      input: '{"title":"Q4 notes"}',
      store: "filesystem",
    });

    expect(process.exitCode).toBe(0);
    expect(result.suspended?.suspensionId).toMatch(/^susp/);
    expect(existsSync(join(workDir, ".fsdev/data/fsdev.db"))).toBe(false);
    const { request, stops } = await readBack(
      createFilesystemStores({ rootDir: join(workDir, ".fsdev/data"), developmentOnly: true }),
      result.suspended!.requestId,
    );
    expect(request?.status).toBe("suspended");
    expect(stops).toHaveLength(1);
    // The single-process limit is said where the flag is used.
    expect(stderrText).toMatch(/single-process/);
  });

  it("OFF STATE: on in-memory stores the stop is refused at the stop, naming the setting", async () => {
    const stores = createInMemoryStores();
    const result = await executeRunCommand("review", "submit", {
      cwd: fixtureDir,
      input: '{"title":"Q1 notes"}',
      stores,
    });

    expect(process.exitCode).toBe(1);
    expect(result.success).toBe(false);
    expect(result.suspended).toBeUndefined();
    expect(result.error?.message).toMatch(/durable execution/);
    expect(await stores.suspensions.list({})).toEqual([]);
  });

  it("refuses --store beside an app config, whose stores are the app's", async () => {
    const err = await executeRunCommand("echo", "respond", {
      cwd: configDir,
      input: '{"message":"hi"}',
      store: "filesystem",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(err.message).toMatch(/--store/);
  });

  it("refuses a --store it doesn't know", async () => {
    const err = await executeRunCommand("review", "submit", {
      cwd: fixtureDir,
      input: '{"title":"x"}',
      store: "postgres" as never,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
  });
});
