/**
 * A session the lab opens works in a repository: the one the picked project
 * names, written by the server when the session opens (workforce's
 * `setSessionFields`), and read back off the session as the client reads it.
 * On the lab's own host, in process, through `src/app/`'s calls.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { openClaudeCodeStyle } from "../host.mts";
import { appCalls } from "../src/app";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0)) await done();
});

/** A repository the lab may cut from: committed, ignoring `.fsdev/`. */
function repository(dir: string): string {
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  execFileSync("git", ["-C", dir, "add", "-A"], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { env });
  return dir;
}

describe("a session the lab opens", () => {
  it("works in the picked project's repository, written by the server at open", async () => {
    const data = mkdtempSync(join(tmpdir(), "ccs-opens-"));
    const first = repository(join(data, "first"));
    const second = repository(join(data, "second"));
    const { flowState } = await openClaudeCodeStyle({ data, userId: "u_lab", model: "test/scripted", utilityModel: "test/utility", repositories: [first, second] });
    cleanup.push(async () => {
      await (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.();
      rmSync(data, { recursive: true, force: true });
    });
    const fetcher = createInProcessFetch(flowState as never) as never;
    const client = createClient({ userId: "u_lab", baseUrl: "", fetcher });
    const lab = appCalls(client, { fetcher });
    await lab.createProject("first", `file://${first}`);
    const picked = await lab.createProject("second", `file://${second}`);

    for (const mode of ["session", "threads"] as const) {
      const opened = await lab.openSession(mode, picked.id);
      expect((await client.sessions.get(opened.id)).state).toMatchObject({ repository: `file://${second}` });
    }
  });
});
