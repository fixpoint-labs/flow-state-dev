/**
 * The declared collections, registered against a real directory.
 *
 * What is actually under test here is the **scope model**, because that is the
 * part of M1 that fails silently when it is wrong: a ledger written to the
 * lineage root instead of the workstream is readable by every sibling issue and
 * nothing complains, and a registry written to a session is invisible to the
 * cron sweep that exists to read it. Nothing here asserts that a file appears —
 * it asserts *which scope instance* holds it, which is the same question stated
 * in the terms `entities.ts` decided.
 *
 * The store is real: a temporary directory, actual writes, actual reads back.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  conductorArtifacts,
  conductorIssues,
  conductorLedger,
  conductorObservations,
  conductorRegistry,
} from "../../src/model/entities";
import {
  addressFor,
  conductorCollections,
  type ConductorScopeIds,
} from "../../src/runtime/collections";
import { ConductorStateError, fileStateStore } from "../../src/runtime/store";

const ORG = "github.com/fixpoint-labs/flow-state-dev";
const EPIC_SESSION = "session-epic";
const WORKSTREAM = "session-workstream";

/** An epic session with an issue workstream under it — the two-address case. */
const IDS: ConductorScopeIds = {
  orgId: ORG,
  sessionId: WORKSTREAM,
  lineageId: EPIC_SESSION,
};

let statePath: string;

async function openState() {
  statePath = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-state-"));
  return fileStateStore(statePath);
}

afterEach(async () => {
  if (statePath) await fs.rm(statePath, { recursive: true, force: true });
});

describe("where a collection's declared scope puts it", () => {
  it("addresses the registry at the org, and nothing else there", () => {
    expect(addressFor(conductorRegistry, IDS)).toEqual({ scope: "org", scopeId: ORG });
  });

  it("addresses the entity graph at the lineage root, so a workstream reads its epic's", () => {
    // `sharedToWorkstream` — the epic session and every issue workstream under
    // it resolve one instance set.
    expect(addressFor(conductorIssues, IDS).scopeId).toBe(EPIC_SESSION);
    expect(addressFor(conductorArtifacts, IDS).scopeId).toBe(EPIC_SESSION);
  });

  it("addresses a working record at the running session, and nowhere above it", () => {
    expect(addressFor(conductorLedger, IDS).scopeId).toBe(WORKSTREAM);
    expect(addressFor(conductorObservations, IDS).scopeId).toBe(WORKSTREAM);
  });

  it("refuses to address a session-scoped collection before the session is known", () => {
    // The registry is the one collection readable with no work item in hand.
    // Guessing an address for the others would write state nothing reads back.
    const noSession: ConductorScopeIds = { orgId: ORG, sessionId: null, lineageId: null };
    expect(addressFor(conductorRegistry, noSession).scopeId).toBe(ORG);
    expect(() => addressFor(conductorLedger, noSession)).toThrow(ConductorStateError);
  });
});

describe("the ledger, in the session that reduced it", () => {
  it("is invisible from a sibling workstream, and the entity graph is not", async () => {
    const store = await openState();
    const mine = conductorCollections(store, IDS);
    const sibling = conductorCollections(store, {
      orgId: ORG,
      sessionId: "session-other-issue",
      lineageId: EPIC_SESSION,
    });

    await mine.ledger.write("FIX-1/1", {
      id: "FIX-1/1",
      entityId: "FIX-1",
      entityKind: "issue",
      seq: 1,
      signalKind: "phase_entered",
      signalSynthesized: false,
      signal: null,
      world: null,
      actionKind: "implement",
      phaseBefore: "IMPLEMENTATION",
      phaseAfter: "IMPLEMENTATION",
      gate: null,
      at: "2026-08-20T12:00:00Z",
    });
    await mine.issues.write("FIX-1", {
      id: "FIX-1",
      kind: "issue",
      phase: "IMPLEMENTATION",
      issueType: "Bug",
      epicId: "EPIC-1",
      externalKey: null,
      lastSignalAt: null,
    });

    expect(await sibling.ledger.list()).toEqual([]);
    expect((await sibling.issues.read("FIX-1"))?.phase).toBe("IMPLEMENTATION");
  });
});

describe("records survive the process that wrote them", () => {
  it("reads back through a store opened again over the same directory", async () => {
    const store = await openState();
    await conductorCollections(store, IDS).registry.write("FIX-1", {
      id: "FIX-1",
      kind: "issue",
      sessionId: WORKSTREAM,
      addedAt: "2026-08-20T12:00:00Z",
    });

    const reopened = conductorCollections(fileStateStore(statePath), IDS);
    expect((await reopened.registry.read("FIX-1"))?.sessionId).toBe(WORKSTREAM);
  });

  it("keeps the prose half beside the structured half, and out of it", async () => {
    const store = await openState();
    const { issues } = conductorCollections(store, IDS);
    await issues.write("FIX-1", {
      id: "FIX-1",
      kind: "issue",
      phase: "IMPLEMENTATION",
      issueType: "Bug",
      epicId: null,
      externalKey: null,
      lastSignalAt: null,
    });
    await issues.writeContent("FIX-1", "Add a reverse operation.");

    const reopened = conductorCollections(fileStateStore(statePath), IDS);
    expect(await reopened.issues.readContent("FIX-1")).toBe("Add a reverse operation.");
    // `decide` reads structured state and nothing else; the prose is not in it.
    expect(await reopened.issues.read("FIX-1")).not.toHaveProperty("summary");
  });
});

describe("a record written before a field existed (BP-030)", () => {
  it("reads back carrying the field's declared default", async () => {
    const store = await openState();
    const address = addressFor(conductorLedger, IDS);

    // A row from before `signal`, `world` and `entityKind` were added: auditable,
    // but not replayable, and the caller has to branch on that rather than
    // assume the payload is there.
    await store.write(address, "ledger/FIX-1/1", {
      id: "FIX-1/1",
      entityId: "FIX-1",
      seq: 1,
      signalKind: "approved",
      actionKind: "recordApproval",
      phaseBefore: "SPEC",
      phaseAfter: "IMPLEMENTATION",
      at: "2026-08-20T12:00:00Z",
    });

    const row = await conductorCollections(store, IDS).ledger.read("FIX-1/1");
    expect(row).toMatchObject({
      entityKind: null,
      signal: null,
      world: null,
      signalSynthesized: false,
      gate: null,
    });
  });

  it("reads an issue stored before the goal check as one that has not run", async () => {
    const store = await openState();

    // The verdict gates the merge, so the direction the default falls matters:
    // `null` means *the check has not run*, which opens nothing. A row from
    // before the field existed must not read as a proof nobody took.
    await store.write(addressFor(conductorIssues, IDS), "issues/FIX-1", {
      id: "FIX-1",
      kind: "issue",
      phase: "IMPLEMENTATION",
      issueType: "Bug",
    });

    const row = await conductorCollections(store, IDS).issues.read("FIX-1");
    expect(row).toMatchObject({ goalCheck: null });
  });

  it("reads a verdict stored before its revision as a proof of nothing", async () => {
    const store = await openState();

    // The half-migrated record, and the one whose default direction costs a
    // false merge. Between the verdict shipping and the revision beside it
    // shipping, an issue could be stored as proved with nothing saying *what*
    // was proved. Reading that back as a standing proof would let the very next
    // approval open the merge gate on code no check ever saw, so it has to read
    // as a verdict that describes no revision — which every gate treats as
    // unproved (`model/world`'s `goalCheckFor`).
    await store.write(addressFor(conductorIssues, IDS), "issues/FIX-1", {
      id: "FIX-1",
      kind: "issue",
      phase: "IMPLEMENTATION",
      issueType: "Bug",
      goalCheck: "passed",
    });

    const row = await conductorCollections(store, IDS).issues.read("FIX-1");
    expect(row).toMatchObject({ goalCheck: "passed", goalCheckSha: null });
  });

  it("is loud about a record that does not match the schema at all", async () => {
    const store = await openState();
    await store.write(addressFor(conductorIssues, IDS), "issues/FIX-1", {
      id: "FIX-1",
      kind: "issue",
      phase: "NOT_A_PHASE",
      issueType: "Bug",
    });

    await expect(conductorCollections(store, IDS).issues.read("FIX-1")).rejects.toThrow(
      ConductorStateError,
    );
  });
});

describe("the registry's cap", () => {
  it("refuses a new row rather than evicting one, because the work stays live", async () => {
    const store = await openState();
    const { registry } = conductorCollections(store, IDS);
    const cap = conductorRegistry.maxInstances ?? 0;
    expect(cap).toBeGreaterThan(0);

    // Filling 500 rows through the handle would read the directory 500 times;
    // the store is the same one either way, so seed it directly. The keys are
    // independent and each is its own file, so the seed goes at once rather than
    // one fsync after another — awaited in sequence, the time to reach a cap the
    // declaration owns is a measure of the disk, and the test fails on a slow one.
    const address = addressFor(conductorRegistry, IDS);
    await Promise.all(
      Array.from({ length: cap }, (_, n) =>
        store.write(address, `registry/EPIC-${n}`, {
          id: `EPIC-${n}`,
          kind: "epic",
          sessionId: `session-${n}`,
          addedAt: "2026-08-20T12:00:00Z",
        }),
      ),
    );

    await expect(
      registry.write("EPIC-new", {
        id: "EPIC-new",
        kind: "epic",
        sessionId: "session-new",
        addedAt: "2026-08-20T12:00:00Z",
      }),
    ).rejects.toThrow(/maximum/);

    // An update to a row that already exists is not a new instance.
    await expect(
      registry.write("EPIC-0", {
        id: "EPIC-0",
        kind: "epic",
        sessionId: "session-moved",
        addedAt: "2026-08-20T12:00:00Z",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("keys that could climb out of the store", () => {
  it("are refused rather than encoded", async () => {
    const store = await openState();
    const address = addressFor(conductorLedger, IDS);
    await expect(store.read(address, "ledger/../../escape")).rejects.toThrow(
      ConductorStateError,
    );
  });
});
