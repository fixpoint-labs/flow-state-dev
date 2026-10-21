/**
 * The pin file a host keeps in its root for each listed repository: what it
 * holds, who can read it, and that two host starts on one root never drop
 * each other's pins.
 */
import { spawn } from "node:child_process";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock, releaseLock } from "../src/lock";
import { withoutCredential } from "../src/remotes";
import { pinFetchSettings } from "../src/repository";
import { createRemote, git, tempDir } from "./git-fixtures";

const TOKEN = "ghp_secretsecretsecret";

let root: string;
let repo: string;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  root = tempDir("host");
  repo = join(tempDir("person"), "repo");
  git(join(repo, ".."), "clone", "-q", createRemote().url, repo);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  rmSync(root, { recursive: true, force: true });
});

describe("a pin file is the operator's alone", () => {
  it("is 0600 in a 0700 directory, whatever the umask lets through", () => {
    const umask = process.umask(0o022);
    try {
      const { file } = pinFetchSettings(root, repo);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
    } finally {
      process.umask(umask);
    }
  });

  it("never holds a token written into a remote's URL", () => {
    git(repo, "remote", "add", "tokened", `https://x-access-token:${TOKEN}@github.com/acme/app.git`);
    git(repo, "remote", "add", "user-token", `https://${TOKEN}@github.com/acme/app.git`);
    const pins = pinFetchSettings(root, repo);
    expect(readFileSync(pins.file, "utf8")).not.toContain(TOKEN);
    expect(pins.remotes.get("tokened")).toBe("https://github.com/acme/app.git");
    expect(pins.remotes.get("user-token")).toBe("https://github.com/acme/app.git");
  });
});

describe("what is pinned", () => {
  it("pins a remote named __proto__ like any other, across a restart", () => {
    git(repo, "remote", "add", "__proto__", "https://github.com/acme/proto.git");
    pinFetchSettings(root, repo);
    git(repo, "remote", "set-url", "__proto__", "https://evil.example/acme/proto.git");
    const again = pinFetchSettings(root, repo);
    expect(again.remotes.get("__proto__")).toBe("https://github.com/acme/proto.git");
    expect(Object.keys(JSON.parse(readFileSync(again.file, "utf8")).remotes)).toContain("__proto__");
  });

  it("pins nothing from a file written for another repository, and says so", () => {
    const { file } = pinFetchSettings(root, repo);
    const other = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...other, repo: "/somewhere/else" }));
    const pins = pinFetchSettings(root, repo);
    expect(pins.remotes.size).toBe(0);
    expect(pins.upstreams.size).toBe(0);
    expect(String(warn.mock.calls[0]?.[0])).toContain("not this repository");
    // Left as it was for the person to look at.
    expect(JSON.parse(readFileSync(file, "utf8")).repo).toBe("/somewhere/else");
  });
});

describe("hosts starting together on one root", () => {
  /** A host start in its own process that sees one more remote, `name`, than the repository has. */
  function startElsewhere(name: string): Promise<number | null> {
    const source = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "repository.ts");
    const script =
      "const [source, root, repo] = process.argv.slice(1);" +
      "const { pinFetchSettings } = await import(source);" +
      "pinFetchSettings(root, repo);";
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, source, root, repo], {
        cwd: dirname(source),
        // Config from its own environment, which git lists with the repository's remotes.
        env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `remote.${name}.url`, GIT_CONFIG_VALUE_0: `https://github.com/acme/${name}.git` },
        stdio: ["ignore", "ignore", "inherit"],
      });
      child.on("exit", resolve);
    });
  }

  it("merge one at a time, so neither drops the other's pins", async () => {
    const { file } = pinFetchSettings(root, repo);
    // Another start is mid-merge: it holds the lock and has read the file.
    const lease = await acquireLock(`${file}.lock`, { waitMs: 0, pollMs: 1, staleAfterMs: 60_000 });
    const midMerge = JSON.parse(readFileSync(file, "utf8"));
    const exited = startElsewhere("second");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    // The second start waits rather than writing over the first's merge.
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).remotes)).not.toContain("second");
    midMerge.remotes.first = "https://github.com/acme/first.git";
    writeFileSync(file, JSON.stringify(midMerge));
    releaseLock(lease);
    expect(await exited).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).remotes).sort()).toEqual(["first", "origin", "second"]);
  }, 30_000);
});

describe("withoutCredential", () => {
  it("drops a password or an http(s) user, and keeps an ssh account", () => {
    expect(withoutCredential(`https://user:${TOKEN}@github.com/a/b.git`)).toBe("https://github.com/a/b.git");
    expect(withoutCredential(`https://${TOKEN}@github.com/a/b.git`)).toBe("https://github.com/a/b.git");
    expect(withoutCredential(`ssh://git:${TOKEN}@github.com/a/b.git`)).toBe("ssh://github.com/a/b.git");
    expect(withoutCredential("ssh://git@github.com/a/b.git")).toBe("ssh://git@github.com/a/b.git");
    expect(withoutCredential("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
    expect(withoutCredential("https://github.com/a/b.git")).toBe("https://github.com/a/b.git");
  });
});
