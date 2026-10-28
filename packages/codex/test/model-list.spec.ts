/**
 * `listCodexModels` against a scripted `codex app-server` speaking the pinned
 * CLI's JSON-RPC: the picker's models read off `model/list`, its default
 * first, every page read, and a plain reason for each way the read fails.
 *
 * It matters because the list is the sign-in's: a model the account can't run
 * is one Codex leaves out, so a host that offers this list never leads a
 * person into a refused first turn.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { listCodexModels } from "../src/model-list";

const FAKE = resolve(import.meta.dirname, "fake-app-server.mjs");
const LOG = join(mkdtempSync(join(tmpdir(), "codex-models-")), "app-server.log");
const program = { path: FAKE, pathDirs: [] };

beforeAll(() => {
  chmodSync(FAKE, 0o755);
});

function list(pages: unknown[], mode = "signed-in", timeoutMs?: number) {
  writeFileSync(LOG, "");
  return listCodexModels({
    program,
    env: { PATH: process.env.PATH ?? "", FAKE_APP_SERVER_MODE: mode, FAKE_APP_SERVER_LOG: LOG, FAKE_MODEL_PAGES: JSON.stringify(pages) },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

const row = (model: string, extra: Record<string, unknown> = {}) => ({
  id: model,
  model,
  displayName: model.toUpperCase(),
  description: `About ${model}`,
  hidden: false,
  isDefault: false,
  ...extra,
});

describe("listCodexModels", () => {
  it("lists the models Codex's picker shows, its default first, hidden ones left out", async () => {
    const found = await list([
      { data: [row("gpt-a"), row("gpt-b", { isDefault: true }), row("gpt-old", { hidden: true }), row("gpt-c")], nextCursor: null },
    ]);
    expect(found).toEqual({
      status: "models",
      models: [
        { id: "gpt-b", label: "GPT-B", description: "About gpt-b", isDefault: true },
        { id: "gpt-a", label: "GPT-A", description: "About gpt-a", isDefault: false },
        { id: "gpt-c", label: "GPT-C", description: "About gpt-c", isDefault: false },
      ],
    });
    // The handshake was awaited: the fake refuses model/list before `initialized`.
    expect(readFileSync(LOG, "utf8")).toContain("REQUEST initialized\nREQUEST model/list");
  });

  it("reads every page Codex has", async () => {
    const found = await list([
      { data: [row("gpt-a", { isDefault: true })], nextCursor: "1" },
      { data: [row("gpt-b")], nextCursor: null },
    ]);
    expect(found.status === "models" && found.models.map((model) => model.id)).toEqual(["gpt-a", "gpt-b"]);
  });

  it("an empty list, a refused request, or a Codex that stops is a failure with a plain reason", async () => {
    expect(await list([{ data: [], nextCursor: null }])).toEqual({ status: "failed", reason: "Codex listed no models" });
    expect(await list([])).toEqual({ status: "failed", reason: "Codex could not list its models" });
    expect(await list([], "exit")).toEqual({ status: "failed", reason: "Codex stopped before it answered" });
    expect(await listCodexModels({ env: {}, program: { path: join(tmpdir(), "no-such-codex"), pathDirs: [] } })).toEqual({
      status: "failed",
      reason: "The Codex CLI could not be started",
    });
  });

  it("gives up after its timeout", async () => {
    expect(await list([], "hang", 300)).toEqual({ status: "failed", reason: "Codex did not list its models within 0.3 s" });
  });
});
