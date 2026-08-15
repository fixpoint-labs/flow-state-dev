/**
 * The config layer — discovery, and the errors that stand in for defaults.
 *
 * The claim under test is level 1: `defineConductor()` with no arguments has to
 * produce a fully resolved config from the environment alone. The second claim
 * is the one that keeps the first honest — every discovery that cannot answer
 * raises rather than falling back, because a silent `main` or a silent vendor
 * choice fails twenty minutes later as something else.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { defaultResolveClaudeAgentQuery } from "@flow-state-dev/claude-code/sdk";
import {
  ConductorConfigError,
  defaultGitRunner,
  defaultHarnessProbe,
  defineConductor,
  discoverDefaultBranch,
  discoverDispatcher,
  KNOWN_HARNESSES,
  parseRepoRef,
  resolveConductor,
  type KnownHarness,
} from "../../src/config";
import {
  DEFAULT_REMOTE,
  provisionWorkspace,
  type GitResult,
  type GitRunner,
} from "../../src/dispatch/branch";
import type { Dispatcher } from "../../src/dispatch/types";

/** A git that answers from a table, and reports "not found" for anything else. */
function fakeGit(answers: Record<string, string>): GitRunner {
  return (argv) => {
    const key = argv.join(" ");
    const stdout = answers[key];
    const result: GitResult =
      stdout === undefined
        ? { code: 1, stdout: "", stderr: `no answer for \`git ${key}\`` }
        : { code: 0, stdout, stderr: "" };
    return Promise.resolve(result);
  };
}

const HAPPY = {
  "rev-parse --show-toplevel": "/repo\n",
  "remote get-url origin": "git@github.com:fixpoint-labs/flow-state-dev.git\n",
  "ls-remote --symref origin HEAD": "ref: refs/heads/main\tHEAD\nsha1\tHEAD\n",
  "symbolic-ref --quiet refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
};

const ENV = { GITHUB_TOKEN: "t0ken" } as NodeJS.ProcessEnv;

describe("parseRepoRef", () => {
  it.each([
    ["git@github.com:fixpoint-labs/flow-state-dev.git", "github.com", "fixpoint-labs"],
    ["https://github.com/fixpoint-labs/flow-state-dev.git", "github.com", "fixpoint-labs"],
    ["ssh://git@ghe.internal/acme/thing", "ghe.internal", "acme"],
    ["https://ghe.internal/acme/thing/", "ghe.internal", "acme"],
  ])("reads owner and repo out of %s", (url, host, owner) => {
    expect(parseRepoRef(url)).toMatchObject({ host, owner });
  });

  it("refuses a remote that names no owner, rather than guessing one", () => {
    expect(parseRepoRef("/srv/git/thing.git")).toBeNull();
    expect(parseRepoRef("")).toBeNull();
  });
});

describe("resolveConductor at level 1", () => {
  it("fills in the repo, the base branch, the root and the dispatcher from the environment", async () => {
    const resolved = await resolveConductor(defineConductor(), {
      cwd: "/repo/examples/thing",
      env: ENV,
      git: fakeGit(HAPPY),
      probe: (harness) => harness.vendor === "claude-code",
    });

    expect(resolved.repo).toEqual({
      host: "github.com",
      owner: "fixpoint-labs",
      repo: "flow-state-dev",
    });
    expect(resolved.repoRoot).toBe("/repo");
    expect(resolved.baseBranch).toBe("main");
    expect(resolved.dispatcher.vendor).toBe("claude-code");
    expect(resolved.token).toBe("t0ken");
    expect(resolved.origins).toEqual({
      repoRoot: "discovered",
      repo: "discovered",
      baseBranch: "discovered",
      dispatcher: "discovered",
    });
  });

  it("reads the base branch off the remote even when a local ref disagrees", async () => {
    // The clone-time ref still says `main`; the repository has since moved to
    // `trunk`. Git never refreshes that ref, so preferring it would cut every
    // branch from an obsolete base — and silently, because `main` still exists.
    const resolved = await resolveConductor(defineConductor(), {
      env: ENV,
      git: fakeGit({
        ...HAPPY,
        "ls-remote --symref origin HEAD": "ref: refs/heads/trunk\tHEAD\nsha\tHEAD\n",
      }),
      probe: () => true,
    });
    expect(resolved.baseBranch).toBe("trunk");
    expect(resolved.origins.baseBranch).toBe("discovered");
  });

  it("falls back to the local ref when the remote cannot be reached, and says so", async () => {
    // Offline, or no credentials for a private remote. Taking the cached ref is
    // better than refusing to run, but it is a different answer to a different
    // question — so `origins` reports which one was actually asked.
    const resolved = await resolveConductor(defineConductor(), {
      env: ENV,
      git: fakeGit({
        "rev-parse --show-toplevel": "/repo\n",
        "remote get-url origin": "https://github.com/acme/thing.git\n",
        "symbolic-ref --quiet refs/remotes/origin/HEAD": "refs/remotes/origin/legacy\n",
      }),
      probe: () => true,
    });
    expect(resolved.baseBranch).toBe("legacy");
    expect(resolved.origins.baseBranch).toBe("discovered-cached");
  });

  it("reads GH_TOKEN as well as GITHUB_TOKEN", async () => {
    const resolved = await resolveConductor(defineConductor(), {
      env: { GH_TOKEN: "gh0" } as NodeJS.ProcessEnv,
      git: fakeGit(HAPPY),
      probe: () => true,
    });
    expect(resolved.token).toBe("gh0");
  });

  it("prefers GH_TOKEN when both are set, the order `gh` documents", async () => {
    // The case this decides: a workflow where Actions injects a
    // repository-scoped GITHUB_TOKEN on its own while the operator supplies a
    // broader GH_TOKEN deliberately. Authenticating with the narrower one fails
    // later as a permissions error on an upstream read or write, which is a
    // confusing way to discover a precedence bug.
    const resolved = await resolveConductor(defineConductor(), {
      env: {
        GITHUB_TOKEN: "narrow-token-actions-injected",
        GH_TOKEN: "broad-token-operator-supplied",
      } as NodeJS.ProcessEnv,
      git: fakeGit(HAPPY),
      probe: () => true,
    });
    expect(resolved.token).toBe("broad-token-operator-supplied");
  });
});

describe("a discovery that cannot answer", () => {
  const cases: [string, Parameters<typeof resolveConductor>[1], string][] = [
    [
      "not a checkout",
      { env: ENV, git: fakeGit({}), probe: () => true },
      "repoRoot",
    ],
    [
      "no origin remote",
      {
        env: ENV,
        git: fakeGit({ "rev-parse --show-toplevel": "/repo\n" }),
        probe: () => true,
      },
      "repo",
    ],
    [
      "a remote that is not a GitHub URL",
      {
        env: ENV,
        git: fakeGit({
          "rev-parse --show-toplevel": "/repo\n",
          "remote get-url origin": "/srv/git/thing.git\n",
        }),
        probe: () => true,
      },
      "repo",
    ],
    [
      "no default branch anywhere",
      {
        env: ENV,
        git: fakeGit({
          "rev-parse --show-toplevel": "/repo\n",
          "remote get-url origin": "https://github.com/acme/thing.git\n",
        }),
        probe: () => true,
      },
      "baseBranch",
    ],
    [
      "no coding harness installed",
      { env: ENV, git: fakeGit(HAPPY), probe: () => false },
      "dispatcher",
    ],
    [
      "no GitHub token",
      { env: {} as NodeJS.ProcessEnv, git: fakeGit(HAPPY), probe: () => true },
      "github.token",
    ],
  ];

  it.each(cases)("raises rather than defaulting when there is %s", async (_label, options, field) => {
    await expect(resolveConductor(defineConductor(), options)).rejects.toMatchObject({
      name: "ConductorConfigError",
      field,
    });
  });

  it("names what has to be installed, so the fix is in the message", async () => {
    const error = await resolveConductor(defineConductor(), {
      env: ENV,
      git: fakeGit(HAPPY),
      probe: () => false,
    }).catch((e: unknown) => e as ConductorConfigError);
    // The thing to install, not a binary that resembles it: the dispatcher runs
    // through the Agent SDK, so `claude` on PATH is the wrong instruction.
    expect(error.message).toContain("@anthropic-ai/claude-agent-sdk");
    expect(error.message).not.toContain("PATH");
    expect(error.message).toContain("conductor.config.ts");
  });
});

describe("what the harness probe actually probes", () => {
  /**
   * The regression this guards: the dispatcher runs through the Agent SDK,
   * which bundles its own executable. A probe for a `claude` binary on `PATH`
   * answers a different question — it can say "no harness" on a machine where
   * dispatch works, and "harness found" on one where the SDK will not load.
   */
  it("hands the probe the whole harness, so availability is the harness's own answer", async () => {
    const asked: string[] = [];
    const dispatcher = await discoverDispatcher((harness) => {
      asked.push(harness.vendor);
      // A probe that could only see a binary name could not do this.
      return typeof harness.available === "function";
    });
    expect(asked).toEqual([KNOWN_HARNESSES[0]!.vendor]);
    expect(dispatcher.vendor).toBe("claude-code");
  });

  it("never claims a harness on the strength of a `claude` binary being on PATH", () => {
    // `bin` is gone from the table on purpose: the SDK bundles its own
    // executable, so a name on PATH is neither necessary nor sufficient.
    for (const harness of KNOWN_HARNESSES) {
      expect(harness).not.toHaveProperty("bin");
    }
  });

  it("agrees with the resolver the dispatcher itself loads the SDK through", async () => {
    const claudeCode = KNOWN_HARNESSES.find((h) => h.vendor === "claude-code");
    expect(claudeCode).toBeDefined();

    // Whether the optional peer is installed here is not the point and is not
    // asserted. The point is that the probe and the dispatcher can only ever
    // give the same answer, because they go through one seam.
    const dispatcherCanLoad = await defaultResolveClaudeAgentQuery().then(
      () => true,
      () => false,
    );
    await expect(claudeCode!.available()).resolves.toBe(dispatcherCanLoad);
  });

  it("delegates to the harness rather than deciding anything itself", async () => {
    const stub: KnownHarness = {
      vendor: "stub",
      requires: "nothing",
      available: () => Promise.resolve(true),
      create: () => {
        throw new Error("not created");
      },
    };
    await expect(defaultHarnessProbe(stub)).resolves.toBe(true);
    await expect(
      defaultHarnessProbe({ ...stub, available: () => Promise.resolve(false) }),
    ).resolves.toBe(false);
  });
});

describe("the overrides discovery cannot cover", () => {
  it("takes an explicit repo without reading any remote, and says it was configured", async () => {
    const resolved = await resolveConductor(
      defineConductor({ repo: { host: "github.com", owner: "upstream", repo: "thing" } }),
      {
        env: ENV,
        git: fakeGit({
          "rev-parse --show-toplevel": "/repo\n",
          "symbolic-ref --quiet refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
        }),
        probe: () => true,
      },
    );
    expect(resolved.repo.owner).toBe("upstream");
    expect(resolved.remoteUrl).toBeNull();
    expect(resolved.origins.repo).toBe("configured");
  });

  // The regression: `repoRoot` is typed absolute and every downstream reader is
  // entitled to believe it. A configured relative path was returned untouched,
  // so git discovery, and then worktree provisioning, resolved it against the
  // process's cwd instead of the resolver's — conductor inspecting, and
  // committing to, whichever checkout the process happened to be started from.
  it("anchors a configured relative repoRoot to the resolver's cwd", async () => {
    const cwds: string[] = [];
    const answers = {
      "remote get-url origin": "https://github.com/acme/thing.git\n",
      "ls-remote --symref origin HEAD": "ref: refs/heads/main\tHEAD\nsha1\tHEAD\n",
    };
    const resolved = await resolveConductor(defineConductor({ repoRoot: "checkouts/thing" }), {
      cwd: "/work",
      env: ENV,
      git: (argv, cwd) => {
        cwds.push(cwd ?? "");
        return fakeGit(answers)(argv, cwd);
      },
      probe: () => true,
    });

    expect(resolved.repoRoot).toBe(path.resolve("/work", "checkouts/thing"));
    // Normalizing a path does not change where it came from.
    expect(resolved.origins.repoRoot).toBe("configured");
    // And the value actually reached git as the checkout to read, which is what
    // makes the wrong answer act on the wrong repository rather than just look
    // wrong in a field.
    expect(cwds).not.toContain("checkouts/thing");
    expect(new Set(cwds)).toEqual(new Set([resolved.repoRoot]));
  });

  // Both paths are absolute by one rule rather than two, so a relative answer
  // from either side lands in the same place. Resolving only the configured
  // branch would pass the test above and still leave the two able to disagree.
  it("anchors a discovered repoRoot the same way", async () => {
    const resolved = await resolveConductor(defineConductor(), {
      cwd: "/work",
      env: ENV,
      git: fakeGit({ ...HAPPY, "rev-parse --show-toplevel": "checkouts/thing\n" }),
      probe: () => true,
    });

    expect(resolved.repoRoot).toBe(path.resolve("/work", "checkouts/thing"));
    expect(resolved.origins.repoRoot).toBe("discovered");
  });

  it("uses a named remote for both the repo and the base branch", async () => {
    const resolved = await resolveConductor(defineConductor({ remote: "upstream" }), {
      env: ENV,
      git: fakeGit({
        "rev-parse --show-toplevel": "/repo\n",
        "remote get-url upstream": "https://github.com/acme/thing.git\n",
        "symbolic-ref --quiet refs/remotes/upstream/HEAD": "refs/remotes/upstream/release\n",
      }),
      probe: () => true,
    });
    expect(resolved.repo.owner).toBe("acme");
    expect(resolved.baseBranch).toBe("release");
  });

  // The regression: discovery read `upstream`, but the resolved config had no
  // field to carry that choice into `provisionWorkspace`, whose omitted-remote
  // default is `origin`. A fork would be discovered from upstream and then cut
  // its branches off origin — a different repo, or no repo at all.
  it("carries the named remote through to the resolved config, so provisioning uses the same one discovery did", async () => {
    const resolved = await resolveConductor(defineConductor({ remote: "upstream" }), {
      env: ENV,
      git: fakeGit({
        "rev-parse --show-toplevel": "/repo\n",
        "remote get-url upstream": "https://github.com/acme/thing.git\n",
        "symbolic-ref --quiet refs/remotes/upstream/HEAD": "refs/remotes/upstream/release\n",
      }),
      probe: () => true,
    });
    expect(resolved.remote).toBe("upstream");

    // End to end: what the resolver produced is enough to provision from
    // upstream, with nothing left defaulting to origin.
    const argvs: string[] = [];
    await provisionWorkspace({
      isolation: "cwd",
      repoRoot: resolved.repoRoot,
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      baseBranch: resolved.baseBranch,
      remote: resolved.remote,
      git: (argv) => {
        argvs.push(argv.join(" "));
        // Exit 2 on the probe is "no such branch yet" — the creation path.
        const code = argv[0] === "ls-remote" ? 2 : 0;
        return Promise.resolve({ code, stdout: "", stderr: "" });
      },
    });
    expect(argvs.some((argv) => argv.includes("origin"))).toBe(false);
    expect(argvs).toContain("checkout -B fix/FIX-1 upstream/release");
  });

  it("resolves to origin when no remote is named, matching provisioning's own default", async () => {
    const resolved = await resolveConductor(defineConductor(), {
      env: ENV,
      git: fakeGit(HAPPY),
      probe: () => true,
    });
    expect(resolved.remote).toBe(DEFAULT_REMOTE);
    expect(resolved.remote).toBe("origin");
  });

  it("keeps a supplied dispatcher instead of probing for one", async () => {
    const mine: Dispatcher = {
      vendor: "mine",
      isolation: "remote",
      run: () => {
        throw new Error("not called");
      },
    };
    const resolved = await resolveConductor(defineConductor({ dispatcher: mine }), {
      env: ENV,
      git: fakeGit(HAPPY),
      probe: () => false,
    });
    expect(resolved.dispatcher).toBe(mine);
    expect(resolved.origins.dispatcher).toBe("configured");
  });
});

/**
 * The default branch, against a repository that actually exists.
 *
 * Everything above answers from a table, which is the right shape for the
 * branching but cannot establish the premise the branching rests on: that a
 * clone's `refs/remotes/<remote>/HEAD` does **not** follow the remote when the
 * remote's default branch moves. That is a claim about git's behaviour, so it
 * is checked against git.
 */
describe("the default branch, read from a real remote that moved", () => {
  let scratch: string;

  afterEach(async () => {
    if (scratch) await fs.rm(scratch, { recursive: true, force: true });
  });

  /** A bare remote with `main` and `trunk`, and a clone of it made at `main`. */
  async function cloneWithTwoBranches(): Promise<{ remote: string; clone: string }> {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-head-"));
    const remote = path.join(scratch, "remote.git");
    const seed = path.join(scratch, "seed");
    const clone = path.join(scratch, "clone");

    const run = async (cwd: string, ...argv: string[]) => {
      const result = await defaultGitRunner(argv, cwd);
      if (result.code !== 0) {
        throw new Error(`git ${argv.join(" ")} failed (${result.code}): ${result.stderr}`);
      }
      return result.stdout.trim();
    };

    await run(scratch, "init", "-q", "--bare", "-b", "main", remote);
    await run(scratch, "init", "-q", "-b", "main", seed);
    await run(seed, "config", "user.email", "test@example.com");
    await run(seed, "config", "user.name", "Test");
    await fs.writeFile(path.join(seed, "README.md"), "start\n");
    await run(seed, "add", "--", "README.md");
    await run(seed, "commit", "-q", "-m", "initial");
    await run(seed, "remote", "add", "origin", remote);
    await run(seed, "push", "-q", "origin", "main");
    await run(seed, "branch", "trunk");
    await run(seed, "push", "-q", "origin", "trunk");
    await run(scratch, "clone", "-q", remote, clone);

    return { remote, clone };
  }

  it("follows the remote's new default, which the clone's own ref does not", async () => {
    const { remote, clone } = await cloneWithTwoBranches();

    expect(await discoverDefaultBranch(defaultGitRunner, clone, "origin")).toEqual({
      branch: "main",
      from: "remote",
    });

    // The repository renames its default branch, keeping the old one — the case
    // that makes this silent rather than loud.
    await defaultGitRunner(["symbolic-ref", "HEAD", "refs/heads/trunk"], remote);
    // Everything a well-behaved clone does to stay current. None of it touches
    // refs/remotes/origin/HEAD, which is the whole problem.
    await defaultGitRunner(["fetch", "--all", "--prune"], clone);
    await defaultGitRunner(["remote", "update"], clone);

    const cachedRef = await defaultGitRunner(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      clone,
    );
    expect(cachedRef.stdout.trim()).toBe("refs/remotes/origin/main");

    expect(await discoverDefaultBranch(defaultGitRunner, clone, "origin")).toEqual({
      branch: "trunk",
      from: "remote",
    });
  });

  it("reports the cached ref as cached when the remote is gone", async () => {
    const { remote, clone } = await cloneWithTwoBranches();
    await fs.rm(remote, { recursive: true, force: true });

    expect(await discoverDefaultBranch(defaultGitRunner, clone, "origin")).toEqual({
      branch: "main",
      from: "cached",
    });
  });
});
