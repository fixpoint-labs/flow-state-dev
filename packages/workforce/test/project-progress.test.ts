/**
 * A project's progress, worked out from its workstream entries at read
 * (FIX-1793 BR-18 to BR-20): the pure computation, and `readProject` on the
 * real engine, counting its store reads.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  defineProjectBlocks,
  defineWorkstreamBlocks,
  projectProgress,
  STALE_AFTER_MS,
  WORKSTREAM_OPENED_ENTRY,
  WORKSTREAM_RESOURCES,
  WORKSTREAMS_RESOURCE,
  workstreamEntryKey,
  workstreamOpenedEntry,
  type ProgressEntry
} from "../src/index";
import { bootProjectsHost } from "./projects-harness";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(ms).toISOString();

const entry = (over: Partial<ProgressEntry>): ProgressEntry => ({
  owner: "alice",
  id: "w",
  status: "on-track",
  due: null,
  objectives: [],
  updatedAt: at(NOW),
  ...over
});

describe("projectProgress", () => {
  it("counts workstreams by status and objectives met of total, done ones included", () => {
    const progress = projectProgress(
      [
        entry({ id: "a", status: "on-track", objectives: [{ met: true }, { met: false }] }),
        entry({ id: "b", owner: "bob", status: "at-risk", objectives: [{ met: false }] }),
        entry({ id: "c", status: "blocked" }),
        entry({ id: "d", status: "done", objectives: [{ met: true }, { met: true }] })
      ],
      NOW
    );
    expect(progress).toMatchObject({
      workstreams: 4,
      byStatus: { "on-track": 1, "at-risk": 1, blocked: 1, done: 1 },
      objectives: { met: 3, total: 5 }
    });
  });

  it("takes the earliest due date of a workstream that isn't done, overdue included", () => {
    const progress = projectProgress(
      [
        entry({ id: "a", due: "2026-11-01" }),
        entry({ id: "b", due: "2026-10-01" }),
        entry({ id: "c", status: "done", due: "2026-09-01" }),
        entry({ id: "d", due: null })
      ],
      NOW
    );
    expect(progress.nextDue).toBe("2026-10-01");
    expect(projectProgress([entry({ status: "done", due: "2026-09-01" })], NOW).nextDue).toBeNull();
  });

  it("shows an entry unchanged for seven days as stale, and a done one never (BR-19)", () => {
    const progress = projectProgress(
      [
        entry({ id: "fresh", updatedAt: at(NOW - STALE_AFTER_MS + 1) }),
        entry({ id: "quiet", owner: "bob", updatedAt: at(NOW - STALE_AFTER_MS) }),
        entry({ id: "quieter", updatedAt: at(NOW - 30 * DAY) }),
        entry({ id: "finished", status: "done", updatedAt: at(NOW - 30 * DAY) })
      ],
      NOW
    );
    expect(STALE_AFTER_MS).toBe(7 * DAY);
    expect(progress.stale.map((s) => [s.owner, s.id])).toEqual([
      ["alice", "quieter"],
      ["bob", "quiet"]
    ]);
  });
});

/**
 * In-memory stores that log every resource-state read: `get <key>`,
 * `prefix <prefix>` or `all`, each with its scope. What V4 counts is these,
 * the reads that reach the store.
 */
function countingStores() {
  const registry = createInMemoryStores();
  const stores = { capabilities: ["primary"], resolve: () => Promise.resolve(registry) };
  const reads: string[] = [];
  const inner = registry.resourceState;
  registry.resourceState = new Proxy(inner, {
    get(target, method, receiver) {
      const value = Reflect.get(target, method, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (method === "get") reads.push(`${String(args[0])} get ${String(args[2])}`);
        if (method === "getByPrefix") reads.push(`${String(args[0])} prefix ${String(args[2])}`);
        if (method === "getAll") reads.push(`${String(args[0])} all`);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  });
  return { stores, reads };
}

/** The owner's own entry, aged by flow code as an old write would leave it. */
const age = handler({
  name: "age-entry",
  inputSchema: z.object({ id: z.string(), days: z.number() }),
  outputSchema: z.object({}),
  resources: WORKSTREAM_RESOURCES,
  execute: async (input, ctx) => {
    const entries = ctx.resources[WORKSTREAMS_RESOURCE] as unknown as ResourceCollectionRef;
    const ref = await entries.get(workstreamEntryKey("apollo", ctx.session.identity.userId!, input.id));
    await ref.updateState((state: any) => ({ ...state, updatedAt: at(Date.now() - input.days * DAY) }));
    return {};
  }
});

async function boot() {
  const counting = countingStores();
  const projects = defineProjectBlocks();
  const leadFlow = { kind: "lead", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
  const h = await bootProjectsHost({
    lab: (installation) => ({
      ...projects.actions,
      ...defineWorkstreamBlocks({ installation, leadFlows: [leadFlow] }).actions,
      age: { block: age }
    }),
    leadInternal: () => ({ [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry() })
  }, { stores: counting.stores });
  const lab = (user: string) => h.openSession(user, "lab");
  await h.ok("alice", "lab", await lab("alice"), "createProject", { id: "apollo", title: "Apollo", members: ["bob"] });
  await h.ok("alice", "lab", await lab("alice"), "createProject", { id: "apollo2", title: "Apollo 2", members: ["bob"] });
  /** Run `readProject` as `user`: its answer, the workstream reads its request made, and every read. */
  const countedRead = async (user: string, project: { visibility: "shared" | "private"; id: string }) => {
    const session = await lab(user);
    counting.reads.length = 0;
    const out = (await h.ok(user, "lab", session, "readProject", { project })) as any;
    return { out, reads: counting.reads.filter((read) => read.includes("workstreams")), all: [...counting.reads] };
  };
  return { ...h, lab, countedRead };
}

const apollo = { visibility: "shared" as const, id: "apollo" };

describe("readProject", () => {
  it("reads the row and the project's entries by one prefix, and computes progress from them; nothing is stored (BR-18)", async () => {
    const h = await boot();
    for (const [user, id, objectives] of [
      ["alice", "checkout", ["Ship", "Review"]],
      ["bob", "search", ["Index"]],
      ["bob", "billing", []]
    ] as const) {
      await h.hire(user, `${user}-${id}`, "lead");
      await h.ok(user, "lab", await h.lab(user), "openWorkstream", {
        project: apollo,
        id,
        title: id,
        lead: `${user}-${id}`,
        objectives: [...objectives],
        due: id === "search" ? "2026-11-01" : null
      });
    }
    // A workstream of the project next door, which apollo's prefix must not reach.
    await h.ok("alice", "lab", await h.lab("alice"), "openWorkstream", {
      project: { visibility: "shared", id: "apollo2" },
      id: "other",
      title: "other",
      lead: "alice-checkout"
    });
    await h.ok("alice", "lab", await h.lab("alice"), "updateWorkstream", {
      project: apollo,
      id: "checkout",
      status: "at-risk",
      objectives: [
        { text: "Ship", met: true },
        { text: "Review", met: false }
      ]
    });
    await h.ok("bob", "lab", await h.lab("bob"), "updateWorkstream", { project: apollo, id: "billing", status: "done" });
    await h.ok("bob", "lab", await h.lab("bob"), "age", { id: "search", days: 8 });

    // Mallory is in the org and on no project: a shared project's progress is the org's to read.
    const { out, reads, all } = await h.countedRead("mallory", apollo);
    // One prefix read of apollo's entries: never one per entry, never apollo2's, never a whole scope.
    expect(reads).toEqual(["org prefix workstreams/apollo/"]);
    expect(all.filter((read) => read.endsWith(" all"))).toEqual([]);
    expect(out.workstreams.map((w: any) => [w.owner, w.id])).toEqual([
      ["alice", "checkout"],
      ["bob", "search"],
      ["bob", "billing"]
    ]);
    expect(out.progress).toMatchObject({
      workstreams: 3,
      byStatus: { "on-track": 1, "at-risk": 1, blocked: 0, done: 1 },
      objectives: { met: 1, total: 3 },
      nextDue: "2026-11-01",
      stale: [{ owner: "bob", id: "search" }]
    });
    // The row holds no workstreams and no totals.
    expect(Object.keys(out.project).sort()).toEqual(
      ["brief", "claimTokens", "id", "members", "ownerUserId", "repository", "sessions", "status", "title", "workstreams"].sort()
    );
    expect(out.project.workstreams).toEqual([]);
  });

  it("lands two owners' updates at once, neither waiting on the other (BR-20)", async () => {
    const h = await boot();
    for (const user of ["alice", "bob"]) {
      await h.hire(user, `${user}-lead`, "lead");
      await h.ok(user, "lab", await h.lab(user), "openWorkstream", { project: apollo, id: user, title: user, lead: `${user}-lead` });
    }
    const [aliceLab, bobLab] = [await h.lab("alice"), await h.lab("bob")];
    await Promise.all([
      ...Array.from({ length: 4 }, (_, i) =>
        h.ok("alice", "lab", aliceLab, "updateWorkstream", { project: apollo, id: "alice", report: `alice ${i}`, status: "at-risk" })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        h.ok("bob", "lab", bobLab, "updateWorkstream", { project: apollo, id: "bob", report: `bob ${i}`, status: "blocked" })
      )
    ]);
    const { out } = await h.countedRead("alice", apollo);
    expect(Object.fromEntries(out.workstreams.map((w: any) => [w.owner, w.status]))).toEqual({ alice: "at-risk", bob: "blocked" });
  });

  it("reads a private project for its owner only", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "notes", title: "Notes", visibility: "private" });
    await h.hire("alice", "alice-lead", "lead");
    await h.ok("alice", "lab", await h.lab("alice"), "openWorkstream", {
      project: { visibility: "private", id: "notes" },
      id: "drafts",
      title: "Drafts",
      lead: "alice-lead"
    });
    const mine = (await h.ok("alice", "lab", await h.lab("alice"), "readProject", { project: { visibility: "private", id: "notes" } })) as any;
    expect(mine.workstreams.map((w: any) => w.id)).toEqual(["drafts"]);
    const bobs = await h.act("bob", "lab", await h.lab("bob"), "readProject", { project: { visibility: "private", id: "notes" } });
    expect(JSON.stringify(bobs.error)).toContain("no-such-project");
  });
});
