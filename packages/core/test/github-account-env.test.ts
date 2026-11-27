/**
 * `gitHubAccountEnv`: the variables that make a coding run act on GitHub as
 * an account of its own rather than as the person whose machine it runs on.
 *
 * Read through real git, since what matters is what git does with them: a
 * commit authored and committed by the account, an ssh remote reached over
 * https instead (where the person's ssh key isn't used), and a credential
 * asked for github.com answered with the account's token, whatever helper the
 * person's own config names.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitHubAccountEnv, gitHubAccountFrom } from "../src/harness";

const ACCOUNT = { token: "ghp_agent_token", name: "FSD Agent", email: "fsd-agent@users.noreply.github.com" };

let dir: string;
/** git with only what a run would have: PATH, a home, a global config of the person's own, and `extra`. */
const git = (args: string[], extra: Record<string, string> = {}, input?: string) =>
  execFileSync("git", args, {
    cwd: join(dir, "repo"),
    encoding: "utf8",
    input,
    env: { PATH: process.env.PATH ?? "", HOME: dir, GIT_CONFIG_GLOBAL: join(dir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", ...extra },
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gh-account-env-"));
  // The person's own config: their identity, and a helper that would answer with their credential.
  writeFileSync(
    join(dir, "gitconfig"),
    '[user]\n\tname = The Person\n\temail = person@example.com\n[credential]\n\thelper = "!f() { echo username=person; echo password=person-secret; }; f"\n',
  );
  execFileSync("git", ["init", "--quiet", join(dir, "repo")]);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("gitHubAccountEnv", () => {
  it("commits as the account, author and committer both", () => {
    git(["commit", "--allow-empty", "--quiet", "-m", "x"], gitHubAccountEnv(ACCOUNT));
    expect(git(["log", "-1", "--format=%an <%ae> / %cn <%ce>"]).trim()).toBe(
      "FSD Agent <fsd-agent@users.noreply.github.com> / FSD Agent <fsd-agent@users.noreply.github.com>",
    );
  });

  it("answers github.com's credential with the account's token, not the person's helper", () => {
    const filled = git(["credential", "fill"], gitHubAccountEnv(ACCOUNT), "protocol=https\nhost=github.com\n\n");
    expect(filled).toContain("username=x-access-token");
    expect(filled).toContain("password=ghp_agent_token");
    expect(filled).not.toContain("person-secret");
  });

  it("leaves every other host's credential to the person's helper", () => {
    const filled = git(["credential", "fill"], gitHubAccountEnv(ACCOUNT), "protocol=https\nhost=gitlab.example.com\n\n");
    expect(filled).toContain("password=person-secret");
  });

  it("reaches an ssh GitHub remote over https, where the token is what's sent", () => {
    git(["remote", "add", "origin", "git@github.com:acme/app.git"]);
    git(["remote", "add", "other", "ssh://git@github.com/acme/other.git"]);
    const env = gitHubAccountEnv(ACCOUNT);
    expect(git(["remote", "get-url", "--push", "origin"], env).trim()).toBe("https://github.com/acme/app.git");
    expect(git(["remote", "get-url", "other"], env).trim()).toBe("https://github.com/acme/other.git");
  });

  it("hands gh the token under both names it reads", () => {
    expect(gitHubAccountEnv(ACCOUNT)).toMatchObject({ GH_TOKEN: "ghp_agent_token", GITHUB_TOKEN: "ghp_agent_token" });
  });

  it("without it, a run is the person: their identity and their helper", () => {
    git(["commit", "--allow-empty", "--quiet", "-m", "x"]);
    expect(git(["log", "-1", "--format=%an"]).trim()).toBe("The Person");
    expect(git(["credential", "fill"], {}, "protocol=https\nhost=github.com\n\n")).toContain("password=person-secret");
  });
});

describe("gitHubAccountFrom", () => {
  const NAMES = { token: "AGENT_TOKEN", name: "AGENT_NAME", email: "AGENT_EMAIL" };
  const ALL = { AGENT_TOKEN: " ghp_agent ", AGENT_NAME: "FSD Agent", AGENT_EMAIL: "1+fsd-agent@users.noreply.github.com" };

  it("is no account when none is set, or all are blank: the run is the person, as before", () => {
    expect(gitHubAccountFrom({}, NAMES)).toBeUndefined();
    expect(gitHubAccountFrom({ AGENT_TOKEN: " ", AGENT_NAME: "", AGENT_EMAIL: "" }, NAMES)).toBeUndefined();
  });

  it("reads all three, trimmed", () => {
    expect(gitHubAccountFrom(ALL, NAMES)).toEqual({ token: "ghp_agent", name: "FSD Agent", email: "1+fsd-agent@users.noreply.github.com" });
  });

  it("refuses part of an account, naming what's missing: a token with no name would commit as the person", () => {
    expect(() => gitHubAccountFrom({ ...ALL, AGENT_EMAIL: undefined }, NAMES)).toThrow(/AGENT_EMAIL is not set/);
    expect(() => gitHubAccountFrom({ AGENT_NAME: "FSD Agent" }, NAMES)).toThrow(/AGENT_TOKEN, AGENT_EMAIL are not set/);
  });
});
