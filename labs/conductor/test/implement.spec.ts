/**
 * The completion check's state rule, and the seed's identity.
 */
import { describe, expect, it } from "vitest";
import { hasCompletingPr, readCompletion, repoSlugFromRemote } from "../src/implement";
import {
  branchFor,
  checkoutPathFor,
  type RunLocation,
  type RunPrincipal,
  conductorTaskId,
  encodeSegment,
} from "../src/workspace";

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
