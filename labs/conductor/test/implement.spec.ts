/**
 * The completion check's state rule, and the seed's identity.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { seedRepo } from "./harness";
import {
  COMPLETING_QUERY_STATES,
  hasCompletingPr,
  implementPhase,
  prListArgs,
  readCompletion,
  repoSlugFromRemote,
} from "../src/implement";
import {
  branchFor,
  checkoutPathFor,
  type RunLocation,
  type RunPrincipal,
  conductorTaskId,
  encodeSegment,
} from "@flow-state-dev/harness-manager";

/** Temp trees this file made; removed after each test so none outlive the run. */
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A `gh` on PATH that records its argv and answers with an empty listing. */
function recordingGh(): { bin: string; log: string; restore: () => void } {
  const bin = mkdtempSync(join(tmpdir(), "conductor-gh-"));
  const log = join(bin, "argv.log");
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo fixture; exit 0; fi\necho "$@" >> ${log}\necho '[]'\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  const prior = process.env["PATH"];
  process.env["PATH"] = `${bin}${delimiter}${prior ?? ""}`;
  return {
    bin,
    log,
    restore: () => {
      process.env["PATH"] = prior;
    },
  };
}

/** A run context for a checkout, with the fields the completion probe reads. */
function runContext(checkout: string): Record<string, unknown> {
  return {
    epic: "e",
    issue: "FIX-1",
    phase: "implement",
    attempt: 1,
    workspacePath: checkout,
    branch: "conductor/e/FIX-1--implement",
    ctx: {},
  };
}

const ALICE: RunPrincipal = { userId: "alice" };
const EPIC = "conductor-tasks-test-epic";
const at = (issue: string, phase: string): RunLocation => ({
  principal: ALICE,
  epic: EPIC,
  issue,
  phase,
});

describe("the done-condition — which pull requests count", () => {
  it("does NOT complete on a pull request that was closed without merging", async () => {
    // The defect this pins, and it is not hypothetical: a closed-unmerged pull
    // request is an ordinary artifact of this repo's own process. Counting one
    // means a later attempt that exits cleanly completes the task with no open
    // and no merged pull request anywhere — a silent success, re-entering
    // through the completion check that exists to prevent silent successes.
    expect(hasCompletingPr(JSON.stringify([{ number: 1437, state: "CLOSED" }]))).toBe(false);
  });

  it("completes on an open one, and on a merged one", async () => {
    // Both arms matter. Open is the ordinary case; merged is the run that
    // opened a PR and had it merged before the verdict was read — which asking
    // only for open ones would have missed.
    expect(hasCompletingPr(JSON.stringify([{ number: 1, state: "OPEN" }]))).toBe(true);
    expect(hasCompletingPr(JSON.stringify([{ number: 2, state: "MERGED" }]))).toBe(true);
  });

  it("refuses a completing PR whose head is in another repository", () => {
    // `gh pr list --head` matches a branch NAME. A fork can carry a branch with
    // this run's name, and its OPEN or MERGED pull request comes back in the
    // same listing — settling a clean agent run that never opened one. A
    // stranger's branch completing our row is the silent wrong success this
    // check exists to detect, so the head repository is compared.
    const mine = "fixpoint-labs/flow-state-dev";
    const fromAFork = JSON.stringify([
      {
        number: 9,
        state: "MERGED",
        headRepository: { name: "flow-state-dev" },
        headRepositoryOwner: { login: "someone-else" },
      },
    ]);
    expect(hasCompletingPr(fromAFork, mine)).toBe(false);

    const fromMine = JSON.stringify([
      {
        number: 10,
        state: "OPEN",
        headRepository: { name: "flow-state-dev" },
        headRepositoryOwner: { login: "fixpoint-labs" },
      },
    ]);
    expect(hasCompletingPr(fromMine, mine)).toBe(true);
  });

  it("keeps the host, because `-R` without one goes to the wrong server", () => {
    // Reducing an Enterprise remote to `owner/repo` sends the listing to
    // github.com (or `GH_HOST`) instead of the host the checkout came from — a
    // real PR missed, or a same-named one elsewhere settling the task. `gh`
    // documents `-R` as `[HOST/]OWNER/REPO` so this can be said explicitly.
    expect(repoSlugFromRemote("https://github.com/fixpoint-labs/flow-state-dev.git")?.selector).toBe(
      "github.com/fixpoint-labs/flow-state-dev",
    );
    expect(repoSlugFromRemote("git@github.com:fixpoint-labs/flow-state-dev.git")?.selector).toBe(
      "github.com/fixpoint-labs/flow-state-dev",
    );
    expect(repoSlugFromRemote("git@ghe.acme:owner/repo.git")?.selector).toBe("ghe.acme/owner/repo");

    // **The port is part of the host.** This assertion previously demanded
    // `ghe.acme/owner/repo` for a `:8443` remote — a test pinning the defect,
    // written while I was thinking about whether the port could be mistaken for
    // a path segment and not about where the query would land. Dropping it
    // points `gh -R` at the same hostname on 443, which is a different server.
    expect(repoSlugFromRemote("https://ghe.acme:8443/owner/repo")?.selector).toBe(
      "ghe.acme:8443/owner/repo",
    );
    // And the port belongs ONLY to the selector: a pull request row's head
    // identity is `owner/name`, with no host and no port to compare against.
    expect(repoSlugFromRemote("https://ghe.acme:8443/owner/repo")?.ownerRepo).toBe("owner/repo");

    // **A trailing slash is not part of the name.** The strip order used to be
    // `.git` then slashes, so `…/repo.git/` kept its suffix and named a
    // repository called `repo.git` — `gh -R` then found no pull requests for
    // `repo`, and a finished run was reported unfinished and retried until the
    // budget ran out. `git remote add` accepts the URL exactly as typed, so this
    // is a spelling a real remote can carry.
    expect(repoSlugFromRemote("https://github.com/fixpoint-labs/flow-state-dev.git/")?.selector)
      .toBe("github.com/fixpoint-labs/flow-state-dev");
    expect(repoSlugFromRemote("https://github.com/fixpoint-labs/flow-state-dev.git//")?.ownerRepo)
      .toBe("fixpoint-labs/flow-state-dev");
    expect(repoSlugFromRemote("git@github.com:fixpoint-labs/flow-state-dev.git/")?.selector).toBe(
      "github.com/fixpoint-labs/flow-state-dev",
    );
  });

  it("keeps a bracketed IPv6 host whole", () => {
    // **Fifth spelling, and the first whose cost the startup preflight raised.**
    // An unparseable remote used to make the completion probe answer false — a
    // finished run reported unfinished. Now that construction refuses a remote it
    // cannot name, the same gap refuses to build a conductor whose remote `gh`
    // can query: `-R '[2001:db8::1]/owner/repo'` reaches that host's API.
    //
    // The host class stopped at the literal's first colon, so all three
    // spellings returned undefined. IPv4 parsed fine, which is why nothing here
    // noticed.
    expect(repoSlugFromRemote("https://[2001:db8::1]/owner/repo.git")?.selector).toBe(
      "[2001:db8::1]/owner/repo",
    );
    expect(repoSlugFromRemote("https://[2001:db8::1]/owner/repo.git")?.ownerRepo).toBe(
      "owner/repo",
    );
    // The port stays attached to the bracketed host, as it does for a name.
    expect(repoSlugFromRemote("https://[2001:db8::1]:8443/owner/repo")?.selector).toBe(
      "[2001:db8::1]:8443/owner/repo",
    );
    // And the scp-like spelling, which the report did not reach and which failed
    // for the same reason.
    expect(repoSlugFromRemote("git@[2001:db8::1]:owner/repo.git")?.selector).toBe(
      "[2001:db8::1]/owner/repo",
    );

    // **The bracket class must not open a door for a local path.** It excludes
    // `/`, so these stay refused exactly as they were.
    expect(repoSlugFromRemote("/srv/git/[repo]:x")).toBeUndefined();
    expect(repoSlugFromRemote("[not-a-host]")).toBeUndefined();
  });

  it("never asks for a state it would throw away", () => {
    // The defect this pins lives in the ARGUMENTS, not the parsing. The probe
    // used to ask `--state all` and then discard CLOSED — and CLOSED is the
    // only state that grows without bound on this deterministic branch, one per
    // abandoned attempt. Those rows filled the page and pushed the row that
    // counted off it, so a finished run read as unfinished.
    //
    // Asserted on the command rather than on a constant: a test that read back
    // the states list would pass against any implementation, including the one
    // that sent `--state all` anyway.
    // Driven by the constant the probe actually loops over, not by a copy of
    // it. A first version of this test hardcoded the two states and passed
    // against `COMPLETING_QUERY_STATES = ["all"]` — it pinned the argument
    // builder while the thing that chooses the states went unchecked.
    expect(COMPLETING_QUERY_STATES.length).toBeGreaterThan(0);
    for (const state of COMPLETING_QUERY_STATES) {
      const args = prListArgs("conductor/e/FIX-1--implement", state, "owner/repo");
      expect(args).toContain("--state");
      expect(args[args.indexOf("--state") + 1]).toBe(state);
      // The two spellings that reintroduce the unbounded rows.
      expect(args).not.toContain("all");
      expect(args).not.toContain("closed");
      // And the limit is sent rather than inherited — `gh` defaults to 30.
      expect(args[args.indexOf("--limit") + 1]).toBe("100");
      // The head is the branch, not a substring match on it.
      expect(args[args.indexOf("--head") + 1]).toBe("conductor/e/FIX-1--implement");
    }
  });

  it("refuses a saturated page rather than reporting a finished run as unfinished", () => {
    const closed = (n: number) =>
      JSON.stringify(
        Array.from({ length: n }, (_, i) => ({
          number: i + 1,
          state: "CLOSED",
          headRepository: { name: "repo" },
          headRepositoryOwner: { login: "owner" },
        })),
      );

    // A full page of rows that do not count is not evidence that none exists —
    // the completing one may be on a page this listing never asked for. The
    // default `gh` limit is 30 and CLOSED is the state that accumulates without
    // bound, so this is reachable by ordinary use rather than by contrivance.
    expect(() => readCompletion(closed(4), "owner/repo", 4)).toThrow(/whole page/);

    // **Short of saturation the answer stands.** A refusal that fired on any
    // no-match would turn every unfinished run into an error, which is the
    // opposite failure and would pass a test written only for the line above.
    expect(readCompletion(closed(3), "owner/repo", 4)).toBe(false);

    // And a full page that DOES contain a completing pull request answers
    // normally: saturation only matters when the answer would otherwise be no.
    const saturatedButDone = JSON.stringify([
      ...JSON.parse(closed(3)),
      {
        number: 99,
        state: "MERGED",
        headRepository: { name: "repo" },
        headRepositoryOwner: { login: "owner" },
      },
    ]);
    expect(readCompletion(saturatedButDone, "owner/repo", 4)).toBe(true);
  });

  it("queries the repository validate returned, not the one origin names later", async () => {
    // A linked worktree shares `remote.origin.url` with the repository it was
    // cut from, and this probe runs AFTER the coding agent. One
    // `git remote set-url origin` inside the checkout repointed both the `-R`
    // selector and the attribution, so a same-branch pull request in the
    // replacement settled the board while none existed in the configured one.
    //
    // Asserted on the argv `gh` actually received, because the defect is in
    // WHICH repository is queried; a return value cannot show that.
    const repo = mkdtempSync(join(tmpdir(), "conductor-pin-"));
    dirs.push(repo);
    seedRepo(repo);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, stdio: "pipe", encoding: "utf8" });
    git("remote", "set-url", "origin", "https://github.com/validated/repo.git");

    const { bin, log, restore } = recordingGh();
    dirs.push(bin);
    try {
      const phase = implementPhase();
      // Construction-time validation HANDS BACK the identity; the flow binds it
      // into each run context. Nothing is stored on the phase.
      const validated = phase.validate?.({
        root: repo,
        sourceRepo: repo,
        baseRef: "main",
      } as never);
      expect(validated).toBeDefined();

      // The agent repoints origin. The worktree and the source repo share this
      // config, so there is no copy of the old value left to read.
      git("remote", "set-url", "origin", "https://github.com/attacker/repo.git");

      await phase.isDone({ ...runContext(repo), validated } as never);

      const argv = readFileSync(log, "utf8");
      expect(argv).toContain("github.com/validated/repo");
      expect(argv).not.toContain("attacker");
    } finally {
      restore();
    }
  });

  it("gives two conductors from one spec their own repository, with no residue", async () => {
    // The property that removed the need for a guard. One `PhaseSpec` handed to
    // two conductors used to share a pin in its closure — `conductorFlow`
    // snapshots the phase with a spread, which copies function references and
    // not what they close over — so the second construction repointed the
    // first's completion check. `validate` is pure now and the value travels on
    // the run context, so each conductor's is unreachable from the other's.
    const a = mkdtempSync(join(tmpdir(), "conductor-pin-a-"));
    const b = mkdtempSync(join(tmpdir(), "conductor-pin-b-"));
    dirs.push(a, b);
    seedRepo(a);
    seedRepo(b);
    const setOrigin = (dir: string, url: string) =>
      execFileSync("git", ["remote", "set-url", "origin", url], { cwd: dir, stdio: "pipe" });
    setOrigin(a, "https://github.com/one/repo.git");
    setOrigin(b, "https://github.com/two/repo.git");

    const phase = implementPhase();
    const first = phase.validate?.({ root: a, sourceRepo: a, baseRef: "main" } as never);
    const second = phase.validate?.({ root: b, sourceRepo: b, baseRef: "main" } as never);

    // Validating the second neither refuses nor disturbs the first.
    expect((first as { selector: string }).selector).toBe("github.com/one/repo");
    expect((second as { selector: string }).selector).toBe("github.com/two/repo");

    const { bin, log, restore } = recordingGh();
    dirs.push(bin);
    try {
      // Sliced by run rather than indexed by line: each `isDone` makes one
      // listing per counting state, so a positional assertion would compare the
      // first run's second call against the second run — and pass or fail for
      // reasons that have nothing to do with isolation.
      await phase.isDone({ ...runContext(a), validated: first } as never);
      const afterFirst = readFileSync(log, "utf8");
      await phase.isDone({ ...runContext(b), validated: second } as never);
      const afterSecond = readFileSync(log, "utf8").slice(afterFirst.length);

      expect(afterFirst).toContain("github.com/one/repo");
      expect(afterFirst).not.toContain("two/repo");
      expect(afterSecond).toContain("github.com/two/repo");
      expect(afterSecond).not.toContain("one/repo");
    } finally {
      restore();
    }
  });

  it("refuses to query anything when the run context carries no repository", async () => {
    // The pin is bound by `conductorFlow` from what `validate` returned, so an
    // absent one means the probe was reached by a route that never validated.
    //
    // The tempting recovery is to re-read `origin` here, and it used to: that
    // is the defect the pin exists to remove. This probe runs AFTER the agent,
    // and a linked worktree shares `remote.origin.url` with the repository it
    // was cut from, so the answer would be whatever the agent last left there
    // — a same-branch pull request over in the replacement settling the board.
    // Failing re-pends the attempt with a reason; answering wrongly settles it.
    //
    // Asserted through a recording `gh` as well as on the throw, because "did
    // not query" is the half a rejected promise alone does not establish.
    const repo = mkdtempSync(join(tmpdir(), "conductor-nopin-"));
    dirs.push(repo);
    seedRepo(repo);

    const { bin, log, restore } = recordingGh();
    dirs.push(bin);
    try {
      const phase = implementPhase();
      await expect(
        phase.isDone({ ...runContext(repo), validated: undefined } as never),
      ).rejects.toThrow(/no repository to query/);
      expect(existsSync(log)).toBe(false);
    } finally {
      restore();
    }

  });
  it("keeps a port only when it is the API's port", () => {
    // **The earlier `:8443` fix was right, and I generalised it too far.** A
    // port survives only when the transport is the one `gh` talks to. These
    // remotes name an HTTP endpoint, so the port is where the API answers and
    // dropping it would send the listing to a different server.
    expect(repoSlugFromRemote("http://ghe.internal:8443/owner/repo.git")?.selector).toBe(
      "ghe.internal:8443/owner/repo",
    );
    expect(repoSlugFromRemote("https://ghe.internal:8443/owner/repo.git")?.selector).toBe(
      "ghe.internal:8443/owner/repo",
    );

    // These name an SSH daemon or a git daemon. The API is elsewhere, so
    // carrying the port through makes `gh -R` query the wrong port — passing
    // startup and then failing once per attempt, after each paid coding run.
    expect(repoSlugFromRemote("ssh://git@ghe.acme:2222/owner/repo.git")?.selector).toBe(
      "ghe.acme/owner/repo",
    );
    expect(repoSlugFromRemote("git+ssh://git@ghe.acme:2222/owner/repo.git")?.selector).toBe(
      "ghe.acme/owner/repo",
    );
    expect(repoSlugFromRemote("git://ghe.acme:9418/owner/repo.git")?.selector).toBe(
      "ghe.acme/owner/repo",
    );

    // **A bracketed IPv6 literal survives both halves.** Its own colons must
    // not read as a port, and its brackets must not be eaten by the stripper —
    // a port rule written as a plain colon split gets both of these wrong.
    expect(repoSlugFromRemote("ssh://git@[2001:db8::1]:2222/owner/repo.git")?.selector).toBe(
      "[2001:db8::1]/owner/repo",
    );
    expect(repoSlugFromRemote("https://[2001:db8::1]:8443/owner/repo.git")?.selector).toBe(
      "[2001:db8::1]:8443/owner/repo",
    );

    // And a portless remote is untouched on both paths, including the scp-like
    // spelling, which has no port syntax at all.
    expect(repoSlugFromRemote("ssh://git@ghe.acme/owner/repo.git")?.selector).toBe(
      "ghe.acme/owner/repo",
    );
    expect(repoSlugFromRemote("git@ghe.acme:owner/repo.git")?.selector).toBe(
      "ghe.acme/owner/repo",
    );
  });

  it("refuses a transport `gh` cannot query, rather than naming a plausible host", () => {
    // The failure this pins is not a parse error — it is a CONFIDENT one. A
    // scheme-agnostic parser read `file://localhost/owner/repo.git` as the
    // selector `localhost/owner/repo`, so the startup preflight accepted it and
    // the permanent `gh` failure arrived once per attempt, after each paid
    // coding run. That is the cost the preflight beside it exists to prevent.
    expect(repoSlugFromRemote("file://localhost/owner/repo.git")).toBeUndefined();

    // **`file:` was the reported one, not the whole set.** All three of these
    // are git transports, and every one produced the same plausible selector.
    expect(repoSlugFromRemote("ftp://example.com/owner/repo.git")).toBeUndefined();
    expect(repoSlugFromRemote("ftps://example.com/owner/repo.git")).toBeUndefined();
    expect(repoSlugFromRemote("rsync://example.com/owner/repo.git")).toBeUndefined();

    // And the other half of the rule: an allow-list that refused a legitimate
    // remote would break every real conductor while passing the four above.
    expect(repoSlugFromRemote("https://github.com/owner/repo.git")?.selector).toBe(
      "github.com/owner/repo",
    );
    expect(repoSlugFromRemote("ssh://git@github.com/owner/repo.git")?.selector).toBe(
      "github.com/owner/repo",
    );
    expect(repoSlugFromRemote("git://github.com/owner/repo.git")?.selector).toBe(
      "github.com/owner/repo",
    );
    expect(repoSlugFromRemote("git+ssh://git@github.com/owner/repo.git")?.selector).toBe(
      "github.com/owner/repo",
    );
    // The scheme is case-insensitive per RFC 3986, and a remote written that
    // way is still the same server.
    expect(repoSlugFromRemote("HTTPS://github.com/owner/repo.git")?.selector).toBe(
      "github.com/owner/repo",
    );
    // The port case the host class exists for, re-asserted here so a change to
    // the scheme cannot quietly take it with it.
    expect(repoSlugFromRemote("http://ghe.internal:8443/owner/repo.git")?.selector).toBe(
      "ghe.internal:8443/owner/repo",
    );
  });

  it("hands the selector and the attribution to their own callers", () => {
    // These are NOT interchangeable, and shipping them as one string made
    // passing the wrong one a typo rather than a type error — which is exactly
    // what happened: `-R` got the host (right) and the attribution check got the
    // host too (never matches), so every completing pull request was rejected
    // and a successful run would have burned its whole retry budget.
    //
    // Asserted as a round trip through the pair, because the defect lived in the
    // JOIN between two things that were each individually correct.
    const repo = repoSlugFromRemote("git@ghe.acme:owner/repo.git");
    expect(repo?.selector).toBe("ghe.acme/owner/repo");
    expect(repo?.ownerRepo).toBe("owner/repo");

    const matching = JSON.stringify([
      {
        number: 1,
        state: "OPEN",
        headRepository: { name: "repo" },
        headRepositoryOwner: { login: "owner" },
      },
    ]);
    // The attribution field accepts it; the selector field does not. That
    // asymmetry is the bug, pinned.
    expect(hasCompletingPr(matching, repo?.ownerRepo)).toBe(true);
    expect(hasCompletingPr(matching, repo?.selector)).toBe(false);
  });

  it("attributes a row whose casing differs from the remote's", () => {
    // GitHub owner and repository names are case-INSENSITIVE, and the API
    // answers in one canonical casing whatever the remote spells. So a checkout
    // cloned from `Fixpoint-Labs/Flow-State-Dev` reaches the same repository,
    // `gh -R` accepts it — and an exact comparison then rejects every pull
    // request the run actually opened, reporting a successful run unfinished and
    // spending its retries. The same harm the attribution check was added to
    // prevent, arriving through the check: a second door on the rule I closed
    // one door of last round.
    const remote = repoSlugFromRemote("git@github.com:Fixpoint-Labs/Flow-State-Dev.git");
    expect(remote?.ownerRepo).toBe("Fixpoint-Labs/Flow-State-Dev");

    const canonical = JSON.stringify([
      {
        number: 1442,
        state: "OPEN",
        headRepository: { name: "flow-state-dev" },
        headRepositoryOwner: { login: "fixpoint-labs" },
      },
    ]);
    expect(hasCompletingPr(canonical, remote?.ownerRepo)).toBe(true);

    // The fold must not become a wildcard: a DIFFERENT repository is still
    // refused however it is cased, which is the rule the fold is bending.
    expect(hasCompletingPr(canonical, "Someone-Else/Flow-State-Dev")).toBe(false);
  });

  it("refuses a remote it cannot name, rather than guessing one", () => {
    // Undefined is a refusal, not a fallback: a remote we cannot name is a
    // repository we cannot pin the listing to, and an unpinned listing is the
    // thing this reading exists to prevent.
    expect(repoSlugFromRemote("")).toBeUndefined();
    expect(repoSlugFromRemote("not-a-url")).toBeUndefined();
    // A local path is not a repository `gh` can be pointed at.
    expect(repoSlugFromRemote("/srv/git/repo")).toBeUndefined();
    expect(repoSlugFromRemote("../sibling")).toBeUndefined();
    // A deeper path is a shape `gh -R` does not accept; refused rather than
    // silently trimmed to its last two segments.
    expect(repoSlugFromRemote("https://gitlab.com/group/sub/repo")).toBeUndefined();
  });

  it("refuses a row it cannot attribute to a repository", () => {
    // Same reasoning as the missing `state` case above (BP-030): an answer we
    // cannot classify must not complete a task, and one we cannot ATTRIBUTE is
    // the same problem wearing a different field.
    expect(
      hasCompletingPr(JSON.stringify([{ number: 11, state: "MERGED" }]), "owner/repo"),
    ).toBe(false);
  });

  it("takes the branch when any row counts, even beside a closed one", async () => {
    // A branch can carry a closed attempt and a live one.
    expect(
      hasCompletingPr(
        JSON.stringify([
          { number: 1, state: "CLOSED" },
          { number: 2, state: "OPEN" },
        ]),
      ),
    ).toBe(true);
  });

  it("refuses anything it cannot classify, rather than completing", async () => {
    // BP-030: an answer we cannot read must not complete a task. Empty output,
    // malformed JSON, a row with no state, a shape that is not a list.
    for (const stdout of ["", "[]", "not json", '[{"number":1}]', '{"number":1}']) {
      expect(hasCompletingPr(stdout)).toBe(false);
    }
  });
});

describe("the forced ask tells the run to keep the marker out of the commit", () => {
  /** The minimum a prompt builder needs; none of it is what these assert. */
  const promptRun = (askMarkerPath: string) =>
    ({
      epic: EPIC,
      issue: "FIX-1219",
      phase: "implement",
      attempt: 1,
      workspacePath: "/tmp/does-not-matter",
      branch: "conductor/FIX-1219/implement",
      answers: [],
      askMarkerPath,
      ctx: {} as never,
    }) as never;

  it("instructs rather than reassures, because the rule can stop holding mid-run", async () => {
    // It used to say the file "is already gitignored, so it will not be
    // committed" — a promise nothing can keep for the length of a run.
    // Provisioning checks the rule at the door, and `.gitignore` is a TRACKED
    // file in the tree the run is about to edit: a task that legitimately
    // rewrites it and then runs `git add -A` stages every marker under
    // `.fsdev/`, and the next attempt's check catches that one commit late.
    //
    // A run reassured the file cannot be committed has no reason to look, so
    // the reassurance is worse than silence — it is the only party holding the
    // shell at the moment the rule stops being true.
    const prompt = await implementPhase().buildPrompt(promptRun("/w/.fsdev/ask/1.md"));

    expect(prompt).toMatch(/Never stage or commit anything under `\.fsdev\/`/);
    expect(prompt).not.toMatch(/will not be committed/);
  });

  it("still spells the marker path in full", async () => {
    // The instruction not to commit it is useless if the run cannot find where
    // to write it. Asserted separately: one is the seam, the other is the
    // safeguard, and merged they would fail under a single name.
    const prompt = await implementPhase().buildPrompt(promptRun("/w/.fsdev/ask/7.md"));

    expect(prompt).toContain("/w/.fsdev/ask/7.md");
  });
});

describe("the board task's identity", () => {
  it("is stable per issue-phase, so a repeated seed cannot mint a second run", () => {
    // Two rows for one issue-phase derive the same checkout, the same branch and
    // the same run record — so a duplicated seed charges two full coding runs
    // whose claims overwrite one shared record.
    expect(conductorTaskId("FIX-1219", "implement")).toBe(
      conductorTaskId("FIX-1219", "implement"),
    );
    expect(conductorTaskId("FIX-1219", "implement")).not.toBe(
      conductorTaskId("FIX-1219", "review"),
    );
    expect(conductorTaskId("FIX-1219", "implement")).not.toBe(
      conductorTaskId("FIX-1220", "implement"),
    );
  });

  it("is validated like a path segment, because it lands in the ledger's key space", () => {
    for (const bad of ["../escape", "a/b", "..", "", "with space"]) {
      expect(() => conductorTaskId(bad, "implement")).toThrow(/not a usable identity segment/);
      expect(() => conductorTaskId("FIX-1", bad)).toThrow(/not a usable identity segment/);
    }
  });

  it("agrees with the checkout and branch it is derived alongside", () => {
    // One issue-phase, one identity everywhere — the property that makes a
    // duplicate seed a duplicate of something rather than a second run.
    const config = { root: "/w", sourceRepo: "/r", baseRef: "main" };
    expect(checkoutPathFor(config, at("FIX-1219", "implement"))).toContain(
      conductorTaskId("FIX-1219", "implement"),
    );
    expect(branchFor(at("FIX-1219", "implement"))).toBe(
      // The principal segment is DERIVED, not spelled: it is a digest, and a
      // literal here would only pin how the digest happens to be computed
      // today. What this asserts is the SHAPE — untenanted tag, principal,
      // board identity, framed leaf.
      `conductor/t0/${encodeSegment("alice")}/conductor-tasks-test-epic/${conductorTaskId("FIX-1219", "implement")}`,
    );
  });
});
