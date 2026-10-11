/**
 * The workforce's projection into the discovery door (FIX-817).
 *
 * The question under every case: would an orchestrator reading this be sent
 * somewhere real? The inventory rows this reads are **append-only** — nothing
 * deletes one for going missing, and `open-inventory.ts` says in its own header
 * that a row means *was registered in this org*, not *still declared*. So a
 * source that simply listed the rows would hand a planner a worker whose file
 * was removed months ago as somewhere to send work, and every shape assertion
 * over it would be green.
 *
 * That is why the undeclared-worker case below is the one that matters, and why
 * it is written as a row that EXISTS alongside one that should be found: a run
 * where both vanish proves nothing.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core/types";
import { workforceManifestSources } from "../src/manifest-sources";
import type { DeclaredWorkforce } from "../src/manifest-sources";
import type { WorkerManifest } from "../src/manifest";

const worker = (id: string, description?: string): WorkerManifest => ({
  id,
  declared: description === undefined ? {} : { description },
  body: ""
});

/** A ctx carrying one stub collection per key, listing the rows it was given. */
function ctxWith(collections: Record<string, unknown[]>, orgId?: string): never {
  const resources: Record<string, unknown> = {};
  for (const [key, rows] of Object.entries(collections)) {
    resources[key] = {
      // `pattern` and `create` are both here because that pair is how the
      // framework's shared lookup recognises a collection ref — a stub with
      // only the method under test would not be found at all.
      pattern: `inventory/${key}/*`,
      create: async () => undefined,
      list: async () => rows.map((state, index) => ({ path: `${key}/${index}`, state }))
    };
  }
  return {
    resources,
    ...(orgId === undefined ? {} : { org: { identity: { orgId, id: orgId } } }),
  } as never;
}

/** The sources, keyed by domain, for a roster and a set of inventory keys. */
function sourcesOf(
  roster: DeclaredWorkforce,
  inventory: { workers?: string },
  hiredRoster?: string,
) {
  const built = workforceManifestSources({ roster, inventory, hiredRoster });
  return Object.fromEntries(built.map((source) => [source.domain, source]));
}

const EMPTY: DeclaredWorkforce = { workers: [] };

describe("the workers source", () => {
  it("projects a registered worker that is still declared, with its file's description", async () => {
    const roster: DeclaredWorkforce = {
      workers: [worker("engineering.lead", "Breaks requests into tasks and assigns them.")]
    };
    const { workers } = sourcesOf(roster, { workers: "workerRows" });
    const ctx = ctxWith({ workerRows: [{ id: "engineering.lead", kind: "agent" }] });

    expect(await workers!.entries(ctx)).toEqual([
      {
        id: "engineering.lead",
        kind: "worker",
        purpose: "Breaks requests into tasks and assigns them.",
        contract: 'Hired into the "agent" worker flow. Hand it work by its id.'
      }
    ]);
  });

  it("BR-12a · withholds a worker whose row survives but whose declaration is gone", async () => {
    const roster: DeclaredWorkforce = {
      workers: [worker("engineering.lead", "Still on the roster.")]
    };
    const { workers } = sourcesOf(roster, { workers: "workerRows" });
    // Both rows are present and well-formed. `engineering.scribe` was hired
    // once and its row was never deleted, because nothing ever deletes one.
    const ctx = ctxWith({
      workerRows: [
        { id: "engineering.lead", kind: "agent" },
        { id: "engineering.scribe", kind: "agent" }
      ]
    });

    expect((await workers!.entries(ctx)).map((entry) => entry.id)).toEqual(["engineering.lead"]);
  });

  it("withholds a row that lost its id rather than projecting an unjoinable entry", async () => {
    const { workers } = sourcesOf({ workers: [worker("a.b", "Here.")] }, {
      workers: "workerRows"
    });
    const ctx = ctxWith({ workerRows: [{ kind: "agent" }, { id: "a.b", kind: "agent" }] });

    expect((await workers!.entries(ctx)).map((entry) => entry.id)).toEqual(["a.b"]);
  });

  it("falls back to the id when a worker file declares no description", async () => {
    const { workers } = sourcesOf({ workers: [worker("a.b")] }, { workers: "workerRows" });
    const [entry] = await workers!.entries(ctxWith({ workerRows: [{ id: "a.b", kind: "agent" }] }));
    expect(entry!.purpose).toBe('The worker "a.b". Its file declares no description.');
  });

  it("FIX-1526 · an inventory row whose roster row was fired is withheld", async () => {
    const { workers } = sourcesOf(EMPTY, { workers: "workerRows" }, "hiredRows");
    const ctx = ctxWith(
      {
        workerRows: [{ id: "acme.eng.ada", kind: "agent" }],
        hiredRows: [],
      },
      "acme",
    );

    expect(await workers!.entries(ctx)).toEqual([]);
  });

  it("FIX-1526 · a file-declared worker still wins over a same-id roster row", async () => {
    const roster: DeclaredWorkforce = {
      workers: [worker("acme.eng.ada", "Declared on disk.")],
    };
    const { workers } = sourcesOf(roster, { workers: "workerRows" }, "hiredRows");
    const ctx = ctxWith(
      {
        workerRows: [{ id: "acme.eng.ada", kind: "agent" }],
        hiredRows: [
          { workerId: "eng.ada", flow: "agent", settings: {}, instructions: "Runtime body that must not win." },
        ],
      },
      "acme",
    );

    const [entry] = await workers!.entries(ctx);
    expect(entry!.purpose).toBe("Declared on disk.");
  });

  it("a dev-org session still lists its workers when a runtime hire there cannot be addressed", async () => {
    // An app with no principal resolver runs as DEFAULT_ORG_ID, and a runtime
    // hire there leaves a roster row whose org is not a legal address segment.
    // That row can never become a worker, but it must cost only itself: the
    // file-declared worker beside it still has to be listed, rather than the
    // whole workers domain degrading to a problem.
    const roster: DeclaredWorkforce = {
      workers: [worker("eng.lead", "Declared on disk.")],
    };
    const { workers } = sourcesOf(roster, { workers: "workerRows" }, "hiredRows");
    const ctx = ctxWith(
      {
        workerRows: [
          { id: "eng.lead", kind: "agent" },
          { id: "eng.ada", kind: "agent" },
        ],
        hiredRows: [
          { workerId: "eng.ada", flow: "agent", settings: {}, owningOrgId: DEFAULT_ORG_ID },
        ],
      },
      DEFAULT_ORG_ID,
    );

    expect((await workers!.entries(ctx)).map((entry) => entry.id)).toEqual(["eng.lead"]);
  });

  it("withholds a roster row stamped for another organization", async () => {
    // The owning-org fence: a row that says it belongs to acme is never minted
    // under the globex session it was read from. Both inventory rows exist, so
    // a fence that re-bound the row to the reading org would list
    // `globex.eng.ada` and fail here.
    const { workers } = sourcesOf(EMPTY, { workers: "workerRows" }, "hiredRows");
    const ctx = ctxWith(
      {
        workerRows: [
          { id: "acme.eng.ada", kind: "agent" },
          { id: "globex.eng.ada", kind: "agent" },
        ],
        hiredRows: [{ workerId: "eng.ada", flow: "agent", settings: {}, owningOrgId: "acme" }],
      },
      "globex",
    );

    expect(await workers!.entries(ctx)).toEqual([]);
  });
});

describe("what gets registered, and what a missing collection does", () => {
  it("registers only the domains whose inventory key was named", () => {
    expect(workforceManifestSources({ roster: EMPTY, inventory: {} })).toEqual([]);
    expect(
      workforceManifestSources({ roster: EMPTY, inventory: { workers: "workerRows" } }).map(
        (source) => source.domain
      )
    ).toEqual(["workers"]);
  });

  it("names both registration sites in the origin, for the duplicate-domain refusal", () => {
    for (const source of workforceManifestSources({
      roster: EMPTY,
      inventory: { workers: "workerRows" }
    })) {
      expect(source.origin).toBe("createWorkforceCapability");
    }
  });

  it("reports a problem rather than an empty domain when the collection is not mounted", async () => {
    const { workers } = sourcesOf({ workers: [worker("a.b", "Here.")] }, {
      workers: "workerRows"
    });
    await expect(workers!.entries(ctxWith({ somethingElse: [] }))).rejects.toThrow(
      /workers collection "workerRows" is not registered/
    );
  });
});
