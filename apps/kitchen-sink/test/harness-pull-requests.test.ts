/**
 * The pull requests a harness session opened, end to end below the page
 * (FIX-2268): the real session flow and the real Cursor block, with Cursor's
 * SDK scripted and `gh` a stub on `PATH`. Worktrees are cut from a real
 * temporary git repository.
 *
 * What the panel relies on: a `gh pr create` the run makes is on the record
 * while the turn still runs, stamped with the turn that opened it; a pull
 * request only GitHub knows about (a raw API call) is added at the turn's end,
 * marked as found on the branch; a `gh pr view` is never on it. Each goal
 * control removes exactly its half.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OBSERVED_PULL_REQUESTS } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import type { CursorSdkMessage, ResolveCursorClient } from "@flow-state-dev/cursor";

import { cursorSessionFlow } from "@/lib/cursor-mode";

let scratch: string;
let repo: string;
let stateHome: string;
let ghDir: string;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-harness-prs-")));
  repo = join(scratch, "repo");
  stateHome = join(scratch, "state");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  // A `gh` that knows one pull request on every branch: #95, opened outside any create call the recorder reads.
  ghDir = join(scratch, "bin");
  mkdirSync(ghDir);
  writeFileSync(
    join(ghDir, "gh"),
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify([{ number: 95, html_url: "https://github.com/acme/app/pull/95", title: "Raw API", state: "open", draft: false, merged_at: null, head: { ref: "x" } }]));
`,
  );
  chmodSync(join(ghDir, "gh"), 0o755);
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", stateHome);
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("GOAL_CONTROL", "");
  vi.stubEnv("PATH", `${ghDir}${delimiter}${process.env.PATH ?? ""}`);
});

afterEach(() => vi.unstubAllEnvs());

type Stores = ReturnType<typeof createInMemoryStores>;

async function rowsOf(stores: Stores, sessionId: string) {
  const entries = await stores.resourceState.getByPrefix("session", sessionId, `${OBSERVED_PULL_REQUESTS}/`);
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [key.slice(OBSERVED_PULL_REQUESTS.length + 1), entry.state as Record<string, unknown>]),
  );
}

function shell(callId: string, command: string, stdout: string): CursorSdkMessage[] {
  const args = { command };
  return [
    { type: "tool_call", call_id: callId, name: "shell", status: "running", args },
    { type: "tool_call", call_id: callId, name: "shell", status: "completed", args, result: { status: "success", value: { exitCode: 0, stdout, stderr: "" } } },
  ];
}

/**
 * A Cursor that opens #88 and views #12, then, before it finishes, looks at
 * the store: what it finds there is what a page reading the record live would.
 */
function openingCursor(stores: Stores, sessionId: string) {
  const seenMidTurn: string[][] = [];
  const resolve: ResolveCursorClient = async () => {
    const agent = {
      agentId: "agent_prs",
      async send() {
        return {
          id: "run_1",
          stream: async function* () {
            yield* shell("c1", "gh pr create --title 'Add notes export' --head notes", "https://github.com/acme/app/pull/88\n");
            yield* shell("c2", "gh pr view 12 --repo other/repo", "url:\thttps://github.com/other/repo/pull/12\n");
            await new Promise((resolve) => setTimeout(resolve, 20));
            seenMidTurn.push(Object.keys(await rowsOf(stores, sessionId)));
            yield { type: "assistant", message: { content: [{ type: "text", text: "Opened it." }] } } as CursorSdkMessage;
          },
          wait: async () => ({ status: "finished" }),
          cancel: async () => {},
        };
      },
      close: () => undefined,
    };
    return { create: async () => agent, resume: async () => agent } as never;
  };
  return { resolve, seenMidTurn };
}

async function turn(sessionId: string, control = "") {
  vi.stubEnv("GOAL_CONTROL", control);
  const stores = createInMemoryStores();
  const cursor = openingCursor(stores, sessionId);
  const result = await testFlow({
    flow: cursorSessionFlow({ resolveCursorClient: cursor.resolve }),
    action: "turn",
    userId: "u",
    sessionId,
    input: { prompt: "open a pull request" },
    stores,
  });
  return { result, rows: await rowsOf(stores, sessionId), seenMidTurn: cursor.seenMidTurn };
}

describe("a harness session's pull requests", () => {
  it("records the opened one while the turn runs, adds the branch's at the end, and never the viewed one", async () => {
    const { result, rows, seenMidTurn } = await turn("s-prs");
    expect(result.status).toBe("completed");
    expect(seenMidTurn).toEqual([["github.com/acme/app/88"]]);
    expect(Object.keys(rows).sort()).toEqual(["github.com/acme/app/88", "github.com/acme/app/95"]);
    expect(rows["github.com/acme/app/88"]).toMatchObject({ source: "tool", requestId: result.requestId, title: "Add notes export" });
    expect(rows["github.com/acme/app/95"]).toMatchObject({ source: "branch", requestId: result.requestId, title: "Raw API" });
  });

  it("under no-pr-record, nothing is on the record mid-turn; only the branch check's row lands", async () => {
    const { rows, seenMidTurn } = await turn("s-no-record", "no-pr-record");
    expect(seenMidTurn).toEqual([[]]);
    expect(Object.keys(rows)).toEqual(["github.com/acme/app/95"]);
  });

  it("under no-backstop, the pull request only GitHub knows about stays missing", async () => {
    const { rows } = await turn("s-no-backstop", "no-backstop");
    expect(Object.keys(rows)).toEqual(["github.com/acme/app/88"]);
  });
});
