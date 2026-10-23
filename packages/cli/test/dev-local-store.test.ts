/**
 * A no-config `fsdev dev` answers a stop a no-config `fsdev run` left behind
 * (FIX-2063 D1, D2).
 *
 * Why it matters: the run exits holding the stop, so the dev server is the only
 * local host that can answer it. That needs the same database, the same local
 * user in the DevTool's session listing, and durable execution on the dev
 * router with no config. Checked over HTTP against a real server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_LOCAL_USER_ID } from "@flow-state-dev/core";
import { executeDevCommand, type DevServer } from "../src/commands/dev";
import { executeRunCommand } from "../src/commands/run";

vi.mock("@flow-state-dev/devtool", () => ({ getAssetPath: () => tmpdir() }));

const fixtureDir = resolve(import.meta.dirname, "fixtures", "durable");

let workDir: string;
let originalCwd: string;
let server: DevServer | undefined;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "fsdev-dev-local-"));
  process.chdir(workDir);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.exitCode = undefined;
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  process.exitCode = undefined;
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(new URL(`/api/flows${path}`, server!.url), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
}

async function requestStatus(sessionId: string, requestId: string): Promise<string | undefined> {
  const { body } = await api(`/sessions/${sessionId}/requests?userId=${DEFAULT_LOCAL_USER_ID}`);
  return (body?.requests as Array<{ id: string; status: string }> | undefined)?.find((r) => r.id === requestId)?.status;
}

describe("no-config fsdev dev answers a no-config fsdev run's stop", () => {
  it("lists it under the DevTool's user, and one approve completes that request", async () => {
    const run = await executeRunCommand("review", "submit", { cwd: fixtureDir, input: '{"title":"Q3 notes"}' });
    const stop = run.suspended!;
    expect(stop).toBeDefined();

    server = await executeDevCommand({ cwd: fixtureDir, port: "0", open: false });

    const sessions = await api(`/sessions?userId=${DEFAULT_LOCAL_USER_ID}`);
    expect((sessions.body.sessions as Array<{ id: string }>).map((s) => s.id)).toContain(stop.sessionId);

    const resumed = await api(`/review/requests/${stop.requestId}/resume`, {
      method: "POST",
      body: JSON.stringify({ suspensionId: stop.suspensionId, action: "approve", userId: DEFAULT_LOCAL_USER_ID }),
    });
    expect(resumed.status).toBeLessThan(300);

    let status: string | undefined;
    for (let i = 0; i < 100 && status !== "completed"; i += 1) {
      status = await requestStatus(stop.sessionId, stop.requestId);
      if (status !== "completed") await new Promise((r) => setTimeout(r, 50));
    }
    expect(status).toBe("completed");
  });
});
