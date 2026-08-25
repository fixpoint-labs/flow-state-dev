/**
 * The completion check's state rule, and the seed's identity.
 */
import { describe, expect, it } from "vitest";
import { hasCompletingPr, repoSlugFromRemote } from "../src/implement";
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
    expect(repoSlugFromRemote("https://github.com/fixpoint-labs/flow-state-dev.git")).toBe(
      "github.com/fixpoint-labs/flow-state-dev",
    );
    expect(repoSlugFromRemote("git@github.com:fixpoint-labs/flow-state-dev.git")).toBe(
      "github.com/fixpoint-labs/flow-state-dev",
    );
    expect(repoSlugFromRemote("git@ghe.acme:owner/repo.git")).toBe("ghe.acme/owner/repo");
    expect(repoSlugFromRemote("https://ghe.acme:8443/owner/repo")).toBe("ghe.acme/owner/repo");
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
