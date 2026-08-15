/**
 * The config layer — discovery, and the errors that stand in for defaults.
 *
 * The claim under test is level 1: `defineConductor()` with no arguments has to
 * produce a fully resolved config from the environment alone. The second claim
 * is the one that keeps the first honest — every discovery that cannot answer
 * raises rather than falling back, because a silent `main` or a silent vendor
 * choice fails twenty minutes later as something else.
 */

import { describe, expect, it } from "vitest";
import { defaultResolveClaudeAgentQuery } from "@flow-state-dev/claude-code/sdk";
import {
  ConductorConfigError,
  defaultHarnessProbe,
  defineConductor,
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

  it("falls back to the remote's own HEAD when the local ref is unset", async () => {
    const resolved = await resolveConductor(defineConductor(), {
      env: ENV,
      git: fakeGit({
        "rev-parse --show-toplevel": "/repo\n",
        "remote get-url origin": "https://github.com/acme/thing.git\n",
        "ls-remote --symref origin HEAD": "ref: refs/heads/trunk\tHEAD\nsha\tHEAD\n",
      }),
      probe: () => true,
    });
    expect(resolved.baseBranch).toBe("trunk");
  });

  it("reads GH_TOKEN as well as GITHUB_TOKEN", async () => {
    const resolved = await resolveConductor(defineConductor(), {
      env: { GH_TOKEN: "gh0" } as NodeJS.ProcessEnv,
      git: fakeGit(HAPPY),
      probe: () => true,
    });
    expect(resolved.token).toBe("gh0");
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
