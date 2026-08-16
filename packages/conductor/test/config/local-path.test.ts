/**
 * The local path, driven the way a project would reach it.
 *
 * Everything here goes through the package's **published surface** —
 * `resolveConductor` from the entry point and `localObserver` from
 * `@flow-state-dev/conductor/local` — because the claim under test is not
 * "conductor can read a checkout" (`test/local/*` and `test/runtime/tick` prove
 * that from the inside) but "a project can *get at* that, on a machine with no
 * GitHub credential on it". A test that deep-imported `src/local/observe`, as
 * every other test here does, would pass with the path shut.
 *
 * The package README documents this as the mode that makes the process runnable
 * without GitHub — no issues burned, no pull requests opened, a kill-mid-gate
 * restart you can actually try. That mode is worth more than the sum of its
 * parts: it is the shortest way to exercise the whole tick where credentials are
 * scarce, so a requirement that closes it costs far more than the field it is
 * asking for.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { localObserver } from "@flow-state-dev/conductor/local";

import { defineConductor, resolveConductor } from "../../src/config";
import { openConductor } from "../../src/runtime/session";
import { fakeDispatcher } from "../../src/testing/fake";
import { createTestRepo, type TestRepo } from "../local/repo";

/** No token under any spelling, and no inherited one either. */
const NO_CREDENTIAL = {} as NodeJS.ProcessEnv;

let repo: TestRepo;
let statePath = "";

afterEach(async () => {
  await repo?.cleanup();
  if (statePath) await fs.rm(statePath, { recursive: true, force: true });
  statePath = "";
});

describe("a checkout with no GitHub credential on the machine", () => {
  it("resolves, opens, and ticks — the local mode the README documents", async () => {
    repo = await createTestRepo();
    statePath = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-local-path-"));

    const dispatcher = fakeDispatcher({ isolation: "remote" });
    // Everything a checkout without a GitHub remote cannot discover is declared,
    // which is what the config fields exist for. The token is the one field with
    // no override — so if resolution demands it, nothing a project can write
    // gets past this line.
    const resolved = await resolveConductor(
      defineConductor({
        repoRoot: repo.root,
        repo: { host: "github.com", owner: "fixpoint-labs", repo: "flow-state-dev" },
        baseBranch: "main",
        dispatcher,
      }),
      { env: NO_CREDENTIAL, git: repo.git },
    );

    expect(resolved.token).toBeNull();

    const session = await openConductor({
      config: resolved,
      statePath,
      observer: localObserver({ repoRoot: repo.root, baseBranch: "main", git: repo.git }),
      git: repo.git,
    });

    await session.manage({
      id: "FIX-1",
      kind: "issue",
      issueType: "Bug",
      phase: "IMPLEMENTATION",
      summary: "Add a `reverse` operation to the registry.",
    });
    const ticked = await session.tick("FIX-1");

    // The tick ran for real: the phase's entry work was dispatched and recorded.
    expect(dispatcher.actionsRun()).toEqual(["implement"]);
    expect(ticked.ledger.map((row) => row.actionKind)).toEqual(["implement"]);
    expect(ticked.entity.phase).toBe("IMPLEMENTATION");
  });

  it("still refuses to read GitHub without one, before any work is managed", async () => {
    repo = await createTestRepo();
    statePath = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-local-path-"));

    const resolved = await resolveConductor(
      defineConductor({
        repoRoot: repo.root,
        repo: { host: "github.com", owner: "fixpoint-labs", repo: "flow-state-dev" },
        baseBranch: "main",
        dispatcher: fakeDispatcher({ isolation: "remote" }),
      }),
      { env: NO_CREDENTIAL, git: repo.git },
    );

    // The other half, and the property the move must not spend: a missing
    // credential is still a startup failure wearing its own name. Only *which*
    // configurations it applies to changed — this one names no observer, so the
    // world would be read from GitHub.
    await expect(
      openConductor({ config: resolved, statePath, git: repo.git }),
    ).rejects.toMatchObject({ name: "ConductorConfigError", field: "github.token" });
  });
});
