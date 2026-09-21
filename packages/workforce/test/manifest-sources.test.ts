/**
 * The workforce's two projections into the discovery door (FIX-817).
 *
 * The question under every case: would an orchestrator reading this be sent
 * somewhere real? The inventory rows these read are **append-only** — nothing
 * ever deletes one, and `open-inventory.ts` says in its own header that a row
 * means *was registered in this org*, not *still declared*. So a source that
 * simply listed the rows would hand a planner a channel that closed months ago
 * as somewhere to send work, and every shape assertion over it would be green.
 *
 * That is why the closed-channel and undeclared-seat cases below are the ones
 * that matter, and why each is written as a row that EXISTS alongside one that
 * should be found: a run where both vanish proves nothing.
 */
import { describe, expect, it } from "vitest";
import { workforceManifestSources } from "../src/manifest-sources";
import type { DeclaredWorkforce } from "../src/manifest-sources";
import type { ChannelManifest, WorkerManifest } from "../src/manifest";

const worker = (id: string, description?: string): WorkerManifest => ({
  id,
  declared: description === undefined ? {} : { description },
  body: ""
});

const channel = (id: string, description?: string): ChannelManifest => ({
  id,
  declared: description === undefined ? {} : { description },
  body: ""
});

/** A ctx carrying one stub collection per key, listing the rows it was given. */
function ctxWith(collections: Record<string, unknown[]>): never {
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
  return { resources } as never;
}

/** The sources, keyed by domain, for a roster and a set of inventory keys. */
function sourcesOf(roster: DeclaredWorkforce, inventory: { seats?: string; channels?: string }) {
  const built = workforceManifestSources({ roster, inventory });
  return Object.fromEntries(built.map((source) => [source.domain, source]));
}

const EMPTY: DeclaredWorkforce = { workers: [], channels: [] };

describe("the seats source", () => {
  it("projects a registered seat that is still declared, with its file's description", async () => {
    const roster: DeclaredWorkforce = {
      workers: [worker("engineering.lead", "Breaks requests into tasks and assigns them.")],
      channels: []
    };
    const { seats } = sourcesOf(roster, { seats: "seatRows" });
    const ctx = ctxWith({ seatRows: [{ id: "engineering.lead", kind: "agent" }] });

    expect(await seats!.entries(ctx)).toEqual([
      {
        id: "engineering.lead",
        kind: "seat",
        purpose: "Breaks requests into tasks and assigns them.",
        contract: 'Hired into the "agent" worker kind. Hand it work by its id.'
      }
    ]);
  });

  it("BR-12a · withholds a seat whose row survives but whose declaration is gone", async () => {
    const roster: DeclaredWorkforce = {
      workers: [worker("engineering.lead", "Still on the roster.")],
      channels: []
    };
    const { seats } = sourcesOf(roster, { seats: "seatRows" });
    // Both rows are present and well-formed. `engineering.scribe` was hired
    // once and its row was never deleted, because nothing ever deletes one.
    const ctx = ctxWith({
      seatRows: [
        { id: "engineering.lead", kind: "agent" },
        { id: "engineering.scribe", kind: "agent" }
      ]
    });

    expect((await seats!.entries(ctx)).map((entry) => entry.id)).toEqual(["engineering.lead"]);
  });

  it("withholds a row that lost its id rather than projecting an unjoinable entry", async () => {
    const { seats } = sourcesOf({ workers: [worker("a.b", "Here.")], channels: [] }, {
      seats: "seatRows"
    });
    const ctx = ctxWith({ seatRows: [{ kind: "agent" }, { id: "a.b", kind: "agent" }] });

    expect((await seats!.entries(ctx)).map((entry) => entry.id)).toEqual(["a.b"]);
  });

  it("falls back to the id when a worker file declares no description", async () => {
    const { seats } = sourcesOf({ workers: [worker("a.b")], channels: [] }, { seats: "seatRows" });
    const [entry] = await seats!.entries(ctxWith({ seatRows: [{ id: "a.b", kind: "agent" }] }));
    expect(entry!.purpose).toBe('The seat "a.b". Its file declares no description.');
  });
});

describe("the channels source", () => {
  it("projects an open, still-declared channel with its members", async () => {
    const roster: DeclaredWorkforce = {
      workers: [],
      channels: [channel("engineering.standup", "Where the team reports progress each morning.")]
    };
    const { channels: source } = sourcesOf(roster, { channels: "channelRows" });
    const ctx = ctxWith({
      channelRows: [
        {
          id: "engineering.standup",
          kind: "channel",
          members: ["engineering.lead", "engineering.scribe"],
          openedAt: "2026-01-04T09:00:00.000Z"
        }
      ]
    });

    expect(await source!.entries(ctx)).toEqual([
      {
        id: "engineering.standup",
        kind: "channel",
        purpose: "Where the team reports progress each morning.",
        contract:
          "2 members: engineering.lead, engineering.scribe. " +
          "Opened 2026-01-04T09:00:00.000Z. Post to it by its id."
      }
    ]);
  });

  it("BR-12a · withholds a channel that has closed, and keeps the one that has not", async () => {
    const roster: DeclaredWorkforce = {
      workers: [],
      channels: [channel("engineering.standup", "Still open.")]
    };
    const { channels: source } = sourcesOf(roster, { channels: "channelRows" });
    // `engineering.retro` reads as open by every signal the ROW carries: it
    // has members and an `openedAt` and no `closedAt` — because there is no
    // such field and no reconcile pass. Its declaration is gone, and that is
    // the only thing that says so.
    const ctx = ctxWith({
      channelRows: [
        { id: "engineering.standup", kind: "channel", members: ["a"], openedAt: "2026-01-04T09:00:00.000Z" },
        { id: "engineering.retro", kind: "channel", members: ["a", "b"], openedAt: "2025-06-01T09:00:00.000Z" }
      ]
    });

    expect((await source!.entries(ctx)).map((entry) => entry.id)).toEqual([
      "engineering.standup"
    ]);
  });

  it("BR-15 · projects a row written before `members` and `openedAt` existed", async () => {
    const roster: DeclaredWorkforce = {
      workers: [],
      channels: [channel("engineering.standup", "Opened by an older build.")]
    };
    const { channels: source } = sourcesOf(roster, { channels: "channelRows" });
    // Exactly what an old row reads back as once the schema's defaults apply,
    // and what a hand-written row can still be: no members, a null timestamp.
    const ctx = ctxWith({
      channelRows: [{ id: "engineering.standup", kind: "channel", members: [], openedAt: null }]
    });

    const [entry] = await source!.entries(ctx);
    expect(entry!.id).toBe("engineering.standup");
    expect(entry!.contract).toBe("0 members. Opened at an unrecorded time. Post to it by its id.");
  });

  it("BR-15 · projects a row that carries neither optional field at all", async () => {
    const roster: DeclaredWorkforce = { workers: [], channels: [channel("a.b", "Here.")] };
    const { channels: source } = sourcesOf(roster, { channels: "channelRows" });
    const ctx = ctxWith({ channelRows: [{ id: "a.b", kind: "channel" }] });

    const [entry] = await source!.entries(ctx);
    expect(entry!.contract).toBe("0 members. Opened at an unrecorded time. Post to it by its id.");
  });
});

describe("what gets registered, and what a missing collection does", () => {
  it("registers only the domains whose inventory key was named", () => {
    expect(workforceManifestSources({ roster: EMPTY, inventory: {} })).toEqual([]);
    expect(
      workforceManifestSources({ roster: EMPTY, inventory: { channels: "channelRows" } }).map(
        (source) => source.domain
      )
    ).toEqual(["channels"]);
    expect(
      workforceManifestSources({
        roster: EMPTY,
        inventory: { seats: "seatRows", channels: "channelRows" }
      }).map((source) => source.domain)
    ).toEqual(["seats", "channels"]);
  });

  it("names both registration sites in the origin, for the duplicate-domain refusal", () => {
    for (const source of workforceManifestSources({
      roster: EMPTY,
      inventory: { seats: "seatRows", channels: "channelRows" }
    })) {
      expect(source.origin).toBe("createWorkforceCapability");
    }
  });

  it("reports a problem rather than an empty domain when the collection is not mounted", async () => {
    const { seats } = sourcesOf({ workers: [worker("a.b", "Here.")], channels: [] }, {
      seats: "seatRows"
    });
    await expect(seats!.entries(ctxWith({ somethingElse: [] }))).rejects.toThrow(
      /seats inventory collection "seatRows" is not registered/
    );
  });
});
