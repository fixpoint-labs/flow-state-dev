/**
 * The session handle, and the one thing about it that is not a pass-through.
 *
 * `openConductor` mostly assembles seams — the interesting behaviour is in
 * `./tick`, and `tick.test.ts` covers it. What lives here is the property the
 * handle itself owns: **two handles over one durable state serialize their
 * ticks**, whichever way the caller spelled the path to it.
 *
 * That is worth its own file because it is the half of the guarantee a caller
 * cannot see. `serializeTick` reads as correct from the inside no matter what
 * key it is given; only a test that opens the *same* state under two spellings
 * can tell whether the key names the state or names the string.
 *
 * The assertion is always the dispatcher, never a count read back from storage.
 * Both ticks derive the same ledger key and the same dispatch id, so the last
 * atomic rename writes one record over the other and the stored counts agree
 * whether the paid work ran once or twice. The dispatcher is the only witness
 * that cannot be overwritten.
 *
 * The other property the handle owns is **which GitHub the default observer
 * talks to**, which no caller can see either: the client is built inside
 * `openConductor` and never handed back, so only a test that watches `fetch`
 * can tell whether the configured host reached the wire.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedConductor } from "../../src/config/define";
import { localObserver } from "../../src/local/observe";
import { openSubmission } from "../../src/local/store";
import { DEFAULT_POLICY } from "../../src/model/world";
import type { Observer } from "../../src/observe/types";
import { openConductor } from "../../src/runtime/session";
import { fakeDispatcher, type FakeDispatcher } from "../../src/testing/fake";
import { createTestRepo, type TestRepo } from "../local/repo";

const ENTITY = "FIX-1";
const T1 = "2026-08-02T00:00:00Z";

let repo: TestRepo;
let statePath: string;

afterEach(async () => {
  await repo?.cleanup();
  if (statePath) await fs.rm(statePath, { recursive: true, force: true });
});

/** A resolved config pointing at the test repo, with a given dispatcher. */
function configFor(dispatcher: FakeDispatcher): ResolvedConductor {
  return {
    repoRoot: repo.root,
    repo: { host: "github.com", owner: "fixpoint-labs", repo: "flow-state-dev" },
    remote: "origin",
    remoteUrl: null,
    baseBranch: "main",
    token: "",
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

/** A clock that moves a second per read, so a tick's rows are ordered. */
function testClock(): () => Date {
  let millis = Date.parse("2026-08-20T12:00:00Z");
  return () => new Date((millis += 1000));
}

/** The observer with a yield in it, so two overlapping ticks really do overlap. */
function slowObserver(inner: Observer): Observer {
  return {
    ...inner,
    async observe(request) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return inner.observe(request);
    },
  };
}

/** Open a session over a given spelling of the state directory. */
function open(dispatcher: FakeDispatcher, spelling: string) {
  return openConductor({
    config: configFor(dispatcher),
    statePath: spelling,
    observer: slowObserver(
      localObserver({ repoRoot: repo.root, baseBranch: "main", git: repo.git }),
    ),
    git: repo.git,
    now: testClock(),
  });
}

describe("two sessions that spell the same state directory differently", () => {
  it("runs the paid dispatch once, as one spelling of it would", async () => {
    repo = await createTestRepo();
    statePath = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-session-"));

    const branch = `fix/${ENTITY}`;
    await repo.run("checkout", "-q", "-b", branch, "main");
    await repo.commit("operations.ts", "// work\n", `work on ${branch}`, T1);
    await repo.run("checkout", "-q", "main");
    await openSubmission(repo.root, branch, "main", T1);

    // Two ordinary ways to name one directory: the absolute path the store
    // resolves to, and a relative path from the process cwd. A cron entry and a
    // service unit disagreeing about which to use is not a corner case, and
    // nothing downstream can tell them apart — `fileStateStore` resolves both,
    // so both sessions read and write the very same files.
    const relative = path.relative(process.cwd(), statePath);
    expect(relative).not.toBe(statePath);
    expect(path.resolve(relative)).toBe(statePath);

    // `remote` isolation: the vendor owns its environment, so conductor
    // provisions no worktree and this test needs no git remote to push to.
    const dispatcher = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: 1 } }],
    });
    const cron = await open(dispatcher, statePath);
    const webhook = await open(dispatcher, relative);

    await cron.manage({
      id: ENTITY,
      kind: "issue",
      issueType: "Bug",
      phase: "IMPLEMENTATION",
      summary: "Add a `reverse` operation to the registry.",
    });

    await Promise.all([cron.tick(ENTITY), webhook.tick(ENTITY)]);

    // One implementation was dispatched, so one was paid for. A second entry
    // here is the duplicate the per-entity lock exists to prevent, arrived at
    // by spelling rather than by racing.
    expect(dispatcher.actionsRun()).toEqual(["implement"]);
  });
});

/**
 * Every URL the default observer asked for, opening on a repo at `host`.
 *
 * The client is built inside `openConductor` and never handed back, so `fetch`
 * is the only place the host it settled on becomes visible. Every call is
 * refused, which is enough: the URL is chosen before the response, and both
 * reads are caught so what is asserted is where they were addressed.
 */
async function urlsPolledForHost(host: string): Promise<string[]> {
  repo = await createTestRepo();
  statePath = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-session-"));

  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string) => {
    requested.push(String(input));
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as typeof globalThis.fetch;

  try {
    const session = await openConductor({
      config: {
        ...configFor(fakeDispatcher({ isolation: "remote", results: [] })),
        repo: { host, owner: "fixpoint-labs", repo: "flow-state-dev" },
        token: "t",
      },
      statePath,
      git: repo.git,
      now: testClock(),
    });

    await session
      .manage({
        id: ENTITY,
        kind: "issue",
        issueType: "Bug",
        phase: "IMPLEMENTATION",
        summary: "Add a `reverse` operation to the registry.",
      })
      .catch(() => undefined);
    await session.tick(ENTITY).catch(() => undefined);
  } finally {
    globalThis.fetch = realFetch;
  }

  expect(requested.length).toBeGreaterThan(0);
  return requested;
}

describe("which GitHub the default observer polls", () => {
  it("addresses the Enterprise host's REST API when the repo lives on one", async () => {
    const requested = await urlsPolledForHost("ghe.example.com");

    // Reading an unrelated *public* repo of the same owner and name is the
    // worse half of this bug — a 404 at least stops — so public GitHub is
    // asserted absent rather than left implied by the prefix check.
    expect(requested.filter((url) => url.includes("api.github.com"))).toEqual([]);
    for (const url of requested) {
      expect(url.startsWith("https://ghe.example.com/api/v3/")).toBe(true);
    }
  });

  it("still addresses api.github.com for a repo on public github.com", async () => {
    // Public GitHub serves its API from a host the remote never names, so the
    // `github.com` case cannot be derived by the same rule as the rest.
    for (const url of await urlsPolledForHost("github.com")) {
      expect(url.startsWith("https://api.github.com/")).toBe(true);
    }
  });
});
