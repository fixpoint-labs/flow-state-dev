/**
 * `readCodexUsage` against a scripted `codex app-server` speaking the pinned
 * CLI's JSON-RPC: every state a person can be shown, the handshake awaited,
 * and the windows read as Codex sends them.
 *
 * The real CLI's two no-number answers are pinned by the spec's POC and by the
 * goal check's legs b and c; this spec holds the reader to the same answers.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readCodexUsage } from "../src/usage";

const FAKE = resolve(import.meta.dirname, "fake-app-server.mjs");
const LOG = join(mkdtempSync(join(tmpdir(), "codex-usage-")), "app-server.log");
const program = { path: FAKE, pathDirs: [] };

beforeAll(() => {
  chmodSync(FAKE, 0o755);
});

function read(mode: string, rateLimits?: unknown, timeoutMs?: number, signal?: AbortSignal) {
  writeFileSync(LOG, "");
  return readCodexUsage({
    program,
    env: {
      PATH: process.env.PATH ?? "",
      FAKE_APP_SERVER_MODE: mode,
      FAKE_APP_SERVER_LOG: LOG,
      ...(rateLimits === undefined ? {} : { FAKE_RATE_LIMITS: JSON.stringify(rateLimits) }),
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  });
}

const FIVE_HOUR = { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_800_000_000 };
const WEEKLY = { usedPercent: 7.5, windowDurationMins: 10_080, resetsAt: 1_800_500_000 };

describe("readCodexUsage", () => {
  it("reads every window of a signed-in account, with its plan and account", async () => {
    const reading = await read("signed-in", {
      rateLimits: { limitId: "codex", limitName: null, primary: FIVE_HOUR, secondary: WEEKLY, planType: "pro" },
      rateLimitsByLimitId: null,
      accountId: "acct_1",
    });
    expect(reading).toEqual({
      status: "windows",
      accountId: "acct_1",
      plan: "pro",
      windows: [
        { id: "codex:primary", label: null, minutes: 300, usedPercent: 42, level: null, resetsAt: 1_800_000_000_000 },
        { id: "codex:secondary", label: null, minutes: 10_080, usedPercent: 7.5, level: null, resetsAt: 1_800_500_000_000 },
      ],
    });
    // The handshake was awaited: the fake refuses account/read before `initialized`.
    expect(readFileSync(LOG, "utf8")).toContain("REQUEST initialized\nREQUEST account/read");
  });

  it("shows every limit in the map, labelled by its name, over the single view", async () => {
    const reading = await read("signed-in", {
      rateLimits: { limitId: "codex", primary: FIVE_HOUR, secondary: null },
      rateLimitsByLimitId: {
        codex: { limitId: "codex", limitName: null, primary: FIVE_HOUR, secondary: WEEKLY },
        codex_other: { limitId: "codex_other", limitName: "GPT-6 Spark", primary: { usedPercent: 90, windowDurationMins: null, resetsAt: null }, secondary: null },
      },
      accountId: null,
    });
    expect(reading.status).toBe("windows");
    if (reading.status !== "windows") return;
    expect(reading.windows.map((w) => [w.id, w.label, w.minutes, w.usedPercent])).toEqual([
      ["codex:primary", null, 300, 42],
      ["codex:secondary", null, 10_080, 7.5],
      ["codex_other:primary", "GPT-6 Spark", null, 90],
    ]);
  });

  it("reads signed out and an API key from account/read, with no percent", async () => {
    expect(await read("signed-out")).toEqual({ status: "signed-out", reason: "Codex is not signed in: not available automatically" });
    expect(await read("api-key")).toEqual({ status: "api-key", reason: "Codex uses an API key: no subscription limit" });
    // Neither asked for limits it could not have.
    expect(readFileSync(LOG, "utf8")).not.toContain("account/rateLimits/read");
  });

  it("reads a CODEX_API_KEY in the run's environment as an API key, over a saved sign-in, and starts no Codex", async () => {
    writeFileSync(LOG, "");
    const reading = await readCodexUsage({
      program,
      env: { PATH: process.env.PATH ?? "", CODEX_API_KEY: "sk-test", FAKE_APP_SERVER_MODE: "signed-in", FAKE_APP_SERVER_LOG: LOG },
    });
    expect(reading).toEqual({ status: "api-key", reason: "Codex uses an API key: no subscription limit" });
    expect(readFileSync(LOG, "utf8")).toBe("");
  });

  it("reads any other failure as unavailable, with a plain reason and never the CLI's words", async () => {
    expect(await read("bedrock")).toMatchObject({ status: "unavailable" });
    // A signed-in account whose limits are refused: the vendor's message stays out.
    expect(await read("refuse-limits")).toEqual({ status: "unavailable", reason: "Codex could not read its limits" });
    expect(await read("exit")).toEqual({ status: "unavailable", reason: "Codex stopped before it answered" });
    expect(await readCodexUsage({ env: {}, program: { path: join(tmpdir(), "no-such-codex"), pathDirs: [] } })).toEqual({
      status: "unavailable",
      reason: "The Codex CLI could not be started",
    });
  });

  it("gives up after its timeout, and on an abort, and stops the child", async () => {
    const started = Date.now();
    expect(await read("hang", undefined, 300)).toEqual({ status: "unavailable", reason: "Codex did not answer within 0.3 s" });
    expect(Date.now() - started).toBeLessThan(5_000);
    const controller = new AbortController();
    const pending = read("hang", undefined, 10_000, controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ status: "unavailable", reason: "The read was stopped before Codex answered" });
  });
});
