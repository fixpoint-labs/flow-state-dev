/**
 * The host's setup command: run once in each checkout a provision makes,
 * before the checkout is handed over, and again until it succeeds.
 *
 * The command here is a small node script that appends the directory it ran
 * in to a log outside the checkout, so each test reads how many times it ran
 * and where, and fails while a `fail` file exists beside the log.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localWorkspaceHost, type LocalWorkspaceHostOptions } from "../src/local-host";
import { createFakeCollection } from "./fake-collection";
import { createRemote, git, tempDir, type Remote } from "./git-fixtures";

let root: string;
let repo: string;
let remote: Remote;
let scratch: string;
let log: string;
let failFlag: string;

const SCRIPT = [
  "const fs = require('fs');",
  "const [log, fail] = process.argv.slice(1);",
  "fs.appendFileSync(log, fs.realpathSync(process.cwd()) + '\\n');",
  "console.log('installing 1 of 2');",
  "if (fs.existsSync(fail)) { console.log('ERR_LOCKFILE_OUT_OF_DATE'); process.exit(3); }",
].join(" ");

beforeEach(() => {
  root = tempDir("setup-host");
  remote = createRemote("marker A");
  repo = join(tempDir("setup-local"), "repo");
  git(join(repo, ".."), "clone", "-q", remote.bare, repo);
  scratch = tempDir("setup-log");
  log = join(scratch, "ran.log");
  failFlag = join(scratch, "fail");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

function host(extra: Partial<LocalWorkspaceHostOptions> = {}) {
  return localWorkspaceHost({
    root,
    remotes: { allow: ["file"] },
    localRepositories: [repo],
    source: () => ({ kind: "refused", reason: "unused", message: "unused" }),
    setup: { command: ["node", "-e", SCRIPT, log, failFlag] },
    ...extra,
  });
}

/** Each directory the setup command ran in, in order. */
function runs(): string[] {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

/** The run source for the local repository. */
const local = () => ({ kind: "repo" as const, repo, baseRef: "main" });

describe("a host's setup command", () => {
  it("runs in a fresh checkout before it is handed over, telling the caller first", async () => {
    const told: string[] = [];
    const place = await host().provision(
      local(),
      { place: ["run-1"], branch: "fsd/run-1", onSetup: () => void told.push(`told; ran ${runs().length}`) },
    );

    // In the checkout itself, so `pnpm install` lands where the run works.
    expect(runs()).toEqual([git(place.cwd, "rev-parse", "--show-toplevel")]);
    expect(place.setup).toEqual({ status: "done" });
    // Told before the command started, so a caller can show "setting up" while it waits.
    expect(told).toEqual(["told; ran 0"]);
  });

  it("does not run again when the checkout is handed back", async () => {
    await host().provision(local(), { place: ["run-1"], branch: "fsd/run-1" });
    let told = 0;
    const again = await host().provision(
      local(),
      { place: ["run-1"], branch: "fsd/run-1", onSetup: () => void (told += 1) },
    );

    expect(runs()).toHaveLength(1);
    expect(again.setup).toBeUndefined();
    expect(told).toBe(0);
  });

  it("hands a failed setup's checkout over with the tail, and runs it again until it succeeds", async () => {
    writeFileSync(failFlag, "");
    const failed = await host().provision(local(), { place: ["run-1"], branch: "fsd/run-1" });

    // Handed over all the same: the run can still work, or fix what broke.
    expect(git(failed.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fsd/run-1");
    expect(failed.setup?.status).toBe("failed");
    const tail = failed.setup?.status === "failed" ? failed.setup.tail : "";
    expect(tail).toContain("ERR_LOCKFILE_OUT_OF_DATE");
    expect(tail).toContain("exited 3");

    // Still owed, so the next provision of the same checkout runs it again.
    rmSync(failFlag);
    const retried = await host().provision(local(), { place: ["run-1"], branch: "fsd/run-1" });
    expect(retried.setup).toEqual({ status: "done" });

    // And once it has succeeded, never again.
    await host().provision(local(), { place: ["run-1"], branch: "fsd/run-1" });
    expect(runs()).toHaveLength(2);
  });

  it("still runs when the provision that made the checkout failed after making it", async () => {
    // Kept files beside the checkout, whose first fill fails once: the tree is
    // made, then the provision throws before setup.
    const collection = createFakeCollection("project-files/**");
    const list = collection.list.bind(collection);
    let failOnce = true;
    collection.list = async (prefix?: string) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("collection unavailable");
      }
      return await list(prefix);
    };
    const answer = { kind: "repo" as const, repo, baseRef: "main", projectId: "p1", files: { collection, collectionId: "project-files" } };

    await expect(host().provision(answer, { place: ["run-1"], branch: "fsd/run-1" })).rejects.toThrow("collection unavailable");
    expect(runs()).toEqual([]);
    const retried = await host().provision(answer, { place: ["run-1"], branch: "fsd/run-1" });

    // The retry hands the same tree back, and the setup it still owes runs.
    expect(retried.repo?.created).toBe(false);
    expect(retried.setup).toEqual({ status: "done" });
    expect(runs()).toEqual([git(retried.cwd, "rev-parse", "--show-toplevel")]);
  });

  it("runs again in a tree made again for a branch that already exists", async () => {
    const first = await host().provision(local(), { place: ["run-1"], branch: "fsd/run-1" });
    rmSync(first.cwd, { recursive: true, force: true });

    const remade = await host().provision(local(), { place: ["run-1"], branch: "fsd/run-1" });

    expect(remade.setup).toEqual({ status: "done" });
    expect(runs()).toHaveLength(2);
  });

  it("runs in the checkout of a cloned remote too", async () => {
    const cloned = await host().provision(
      { kind: "repo", repo: remote.url, baseRef: "main" },
      { place: ["remote-run"], branch: "fsd/remote" },
    );
    expect(cloned.setup).toEqual({ status: "done" });
    expect(runs()).toEqual([git(cloned.cwd, "rev-parse", "--show-toplevel")]);
  });

  it("is stopped by the provision's budget, and says so", async () => {
    const slow = "setTimeout(() => {}, 60000)";
    const place = await host({ setup: { command: ["node", "-e", slow] }, provisionTimeoutMs: 5_000 }).provision(
      local(),
      { place: ["run-1"], branch: "fsd/run-1" },
    );

    expect(place.setup?.status).toBe("failed");
    expect(place.setup?.status === "failed" ? place.setup.tail : "").toContain("provisionTimeoutMs");
  }, 20_000);

  it("stops what the setup command started too, within the budget", async () => {
    // A script whose child outlives it and holds its output open, the way a
    // package manager's lifecycle script can.
    const late = join(scratch, "late");
    const script = `sh -c 'sleep 5; echo late > "${late}"' & wait`;
    const started = Date.now();
    const place = await host({ setup: { command: ["sh", "-c", script] }, provisionTimeoutMs: 3_000 }).provision(
      local(),
      { place: ["run-1"], branch: "fsd/run-1" },
    );
    const took = Date.now() - started;

    expect(place.setup?.status === "failed" ? place.setup.tail : "").toContain("provisionTimeoutMs");
    // Handed over when the budget ran out, not when the child let go of the output.
    expect(took).toBeLessThan(4_500);
    // And the child is gone: it never got to touch anything after the budget.
    await new Promise((resolve) => setTimeout(resolve, 5_500 - took));
    expect(existsSync(late)).toBe(false);
  }, 20_000);

  it("keeps the last of a long error output, where the error is", async () => {
    const noisy = [
      "for (let i = 0; i < 2000; i++) process.stderr.write('progress line ' + i + ' '.repeat(40) + '\\n');",
      "process.stderr.write('FINAL_INSTALL_ERROR\\n');",
      "process.exitCode = 1;",
    ].join(" ");
    const place = await host({ setup: { command: ["node", "-e", noisy] } }).provision(
      local(),
      { place: ["run-1"], branch: "fsd/run-1" },
    );

    expect(place.setup?.status === "failed" ? place.setup.tail : "").toContain("FINAL_INSTALL_ERROR");
  });

  it("names a command that could not start", async () => {
    const place = await host({ setup: { command: ["no-such-setup-command-fsd"] } }).provision(
      local(),
      { place: ["run-1"], branch: "fsd/run-1" },
    );

    expect(place.setup?.status === "failed" ? place.setup.tail : "").toContain("did not run");
  });

  it("runs nothing on a host given no setup", async () => {
    const place = await host({ setup: undefined }).provision(local(), { place: ["run-1"], branch: "fsd/run-1" });

    expect(runs()).toEqual([]);
    expect(place.setup).toBeUndefined();
  });
});
