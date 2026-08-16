/**
 * The tick over the **GitHub** source.
 *
 * `./tick.test.ts` drives the same runtime against a real checkout, and that is
 * the right default: a local observer needs no fixtures to be honest, and the
 * properties it asserts are the source-independent ones. This file exists for
 * the one thing a checkout cannot show, because a checkout does not have it:
 * **GitHub reports comments on two endpoints that number independently**, so
 * two different comments on one pull request can carry the same numeric id.
 *
 * `github/poll` knows that and namespaces its cursor keys `issue:` / `review:`
 * for exactly this reason. Anything downstream that identifies a comment by its
 * bare id therefore treats two different comments as one, and the failure that
 * produces is silent: the second comment is dropped from the queue *and*
 * recorded in the cursor as seen, so nobody is left holding it and no report
 * fires. The assertion here is the dispatch it should have bought — the same bar
 * `github/self-loop.test.ts` holds itself to, from the other direction.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedConductor } from "../../src/config/define";
import type { Dispatcher } from "../../src/dispatch/types";
import { createGitHubClient } from "../../src/github/client";
import { githubObserver } from "../../src/github/observe";
import { DEFAULT_POLICY } from "../../src/model/world";
import { openConductor, type ConductorSession } from "../../src/runtime/session";
import { fakeDispatcher, type FakeDispatcher } from "../../src/testing/fake";
import { createTestRepo, type TestRepo } from "../local/repo";
import {
  BASE_URL,
  OWNER,
  REPO,
  SELF_LOGIN,
  checkRun,
  checkRuns,
  commentPayload,
  pullPayload,
  stubFetch,
  type StubRoute,
} from "../github/fixtures";

const ENTITY = "FIX-1";
const SUMMARY = "Add a `reverse` operation to the registry.";
const PR = 7;
const P = `/repos/${OWNER}/${REPO}`;

let repo: TestRepo;
let statePath: string;

afterEach(async () => {
  await repo?.cleanup();
  if (statePath) await fs.rm(statePath, { recursive: true, force: true });
});

/** A clock that moves a second per read, so a tick's rows are ordered. */
function testClock(): () => Date {
  let millis = Date.parse("2026-08-20T12:00:00Z");
  return () => new Date((millis += 1000));
}

/** A resolved config pointing at the test repo, with a given dispatcher. */
function configFor(dispatcher: Dispatcher): ResolvedConductor {
  return {
    repoRoot: repo.root,
    repo: { host: "github.com", owner: OWNER, repo: REPO },
    remote: "origin",
    remoteUrl: null,
    baseBranch: "main",
    token: "t",
    dispatcher,
    guidance: [],
    goalCheck: null,
    policy: DEFAULT_POLICY,
    origins: {
      repoRoot: "discovered",
      repo: "discovered",
      baseBranch: "discovered",
      dispatcher: "discovered",
    },
  };
}

/**
 * A session reading a GitHub whose comment endpoints the test can change
 * between ticks.
 *
 * The route table is handed to the client by reference and read on every
 * request, so writing into it is a comment being left while conductor is
 * running — which is the only way to put the two endpoints out of step in time.
 */
async function openOverGitHub(dispatcher: Dispatcher): Promise<{
  session: ConductorSession;
  routes: Record<string, StubRoute>;
}> {
  const routes: Record<string, StubRoute> = {
    // The branch lookup `adoptSubmissionForBranch` makes. Nothing here opens a
    // pull request behind conductor's back; the dispatcher reports the one it
    // produced.
    [`GET ${P}/pulls`]: [],
    [`GET ${P}/pulls/${PR}`]: pullPayload(),
    [`GET ${P}/pulls/${PR}/reviews`]: [],
    [`GET ${P}/commits/sha-head/check-runs`]: checkRuns(checkRun("completed", "success")),
    [`GET ${P}/commits/main/check-runs`]: checkRuns(),
    [`GET ${P}/issues/${PR}/comments`]: [],
    [`GET ${P}/pulls/${PR}/comments`]: [],
  };

  const session = await openConductor({
    config: configFor(dispatcher),
    statePath,
    observer: githubObserver(
      createGitHubClient({
        owner: OWNER,
        repo: REPO,
        token: "t",
        baseUrl: BASE_URL,
        fetch: stubFetch(routes),
        selfLogin: SELF_LOGIN,
        botLogins: ["coderabbit"],
      }),
    ),
    git: repo.git,
    now: testClock(),
  });

  return { session, routes };
}

/** Manage the item at implementation, dispatch it, and observe the PR it opened. */
async function drive(dispatcher: FakeDispatcher) {
  repo = await createTestRepo();
  statePath = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-tick-gh-"));

  const { session, routes } = await openOverGitHub(dispatcher);
  await session.manage({
    id: ENTITY,
    kind: "issue",
    issueType: "Bug",
    phase: "IMPLEMENTATION",
    summary: SUMMARY,
  });
  await session.tick(ENTITY);
  await session.tick(ENTITY);
  return { session, routes };
}

/** A dispatcher whose implementation run reports the pull request it opened. */
function harness(): FakeDispatcher {
  // `remote` isolation: the vendor owns its environment, so conductor
  // provisions no worktree and this test needs no git remote to push to.
  return fakeDispatcher({ isolation: "remote", results: [{ produced: { pullNumber: PR } }] });
}

describe("two comment streams that number independently", () => {
  it("answers a review-thread comment whose id an answered issue comment shares", async () => {
    const dispatcher = harness();
    const { session, routes } = await drive(dispatcher);

    // A comment on the conversation, answered by the pass it buys.
    routes[`GET ${P}/issues/${PR}/comments`] = [
      commentPayload({ id: 500, created_at: "2026-08-20T11:00:00Z" }),
    ];
    await session.tick(ENTITY);
    expect(dispatcher.actionsRun()).toEqual(["implement", "addressFeedback"]);

    // A different comment, on a review thread, from a human, that nothing has
    // answered — and whose id GitHub happened to mint from the other endpoint's
    // sequence. Identified by its bare id it looks like the comment above, and
    // is dropped: no dispatch, no ledger row, and the cursor records it as seen
    // so it is never observed again.
    routes[`GET ${P}/pulls/${PR}/comments`] = [
      commentPayload({ id: 500, created_at: "2026-08-20T11:30:00Z", body: "and this line" }),
    ];
    const answered = await session.tick(ENTITY);

    expect(dispatcher.actionsRun()).toEqual([
      "implement",
      "addressFeedback",
      "addressFeedback",
    ]);
    expect(
      answered.ledger.filter((row) => row.actionKind === "addressFeedback"),
    ).toHaveLength(2);

    // And the guarantee that made the bare id look sufficient still holds: with
    // both comments now answered, a further tick over the same two endpoints
    // buys nothing. A fix that merely stopped suppressing would pass the
    // assertions above and fail here.
    const again = await session.tick(ENTITY);
    expect(dispatcher.actionsRun()).toHaveLength(3);
    expect(again.ledger.filter((row) => row.actionKind === "addressFeedback")).toHaveLength(2);
  });
});
