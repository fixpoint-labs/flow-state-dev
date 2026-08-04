/**
 * THROWAWAY POC — not a shipping test.
 *
 * Question set (design conversation on Workstream output-sharing):
 *   Q1  Two Workstreams over ONE mounted collection — what actually happens?
 *   Q2  Two Workstreams over SEPARATE collections — is isolation free?
 *   Q3  How much machinery does "detect, don't merge" take?
 *   Q4  Is a conflict report actionable — are BOTH versions still recoverable?
 *
 * Runs against the real `FileSync` from packages/tools/src/bash/file-sync.ts.
 * Q1a/Q1b assert the CURRENT (buggy) behaviour so the defect is pinned; Q3/Q4
 * assert the proposed base-aware behaviour over the same scenarios.
 */
import { describe, expect, it, vi } from "vitest";
import { FileSync } from "../src/bash/file-sync";
import { hashContent } from "../src/bash/hash";
import type { Sandbox, CommandResult, FileEntryState } from "../src/bash/types";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";

// ─── harness (mirrors packages/tools/test/bash.test.ts) ──────────────────────

function createMockSandbox(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    async executeCommand(command: string): Promise<CommandResult> {
      if (command.startsWith("find ")) {
        return { stdout: Array.from(files.keys()).join("\n"), stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async readFile(p: string): Promise<string> {
      const c = files.get(p);
      if (c === undefined) throw new Error(`File not found: ${p}`);
      return c;
    },
    async writeFile(p: string, content: string): Promise<void> {
      files.set(p, content);
    },
  } satisfies Sandbox & { files: Map<string, string> };
}

type Entry = { name: string; state: FileEntryState; content: string | null };

/** One shared collection; `log` records writes/deletes so clobbers are visible. */
function createCollection(entries: Entry[] = []) {
  const store = new Map<string, Entry>();
  for (const e of entries) store.set(e.name, e);
  const log: string[] = [];

  const makeRef = (entry: Entry): ResourceRef<FileEntryState> => ({
    path: entry.name,
    scope: "session",
    uri: `session/${entry.name}`,
    state: entry.state,
    patchState: vi.fn(async (u: Partial<FileEntryState>) => {
      entry.state = { ...entry.state, ...u };
    }),
    setState: vi.fn(async (n: FileEntryState) => { entry.state = n; }),
    updateState: vi.fn(async (up: any) => { entry.state = await up(entry.state); }),
    readContent: vi.fn(async () => entry.content),
    readContentRaw: vi.fn(async () => entry.content),
    writeContent: vi.fn(async (c: string) => {
      log.push(`write ${entry.name}`);
      entry.content = c;
    }),
    config: { stateSchema: {} as any },
  });

  const col = {
    pattern: "files/*",
    scope: "session" as const,
    log,
    store,
    async get(k: string) {
      const e = store.get(k);
      if (!e) throw new Error(`Not found: ${k}`);
      return makeRef(e);
    },
    async getOptional(k: string) {
      const e = store.get(k);
      return e ? makeRef(e) : undefined;
    },
    create: vi.fn(async (k: string, init?: Partial<FileEntryState>) => {
      const e: Entry = {
        name: k,
        state: { path: k, hash: "", updatedAt: "", ...init } as FileEntryState,
        content: null,
      };
      store.set(k, e);
      return makeRef(e);
    }),
    getOrCreate: vi.fn(async (k: string, init?: Partial<FileEntryState>) => {
      const e = store.get(k);
      if (e) return makeRef(e);
      return col.create(k, init);
    }),
    async list() {
      return Array.from(store.values()).map(makeRef);
    },
    delete: vi.fn(async (k: string) => {
      log.push(`DELETE ${k}`);
      store.delete(k);
    }),
  };
  return col as unknown as ResourceCollectionRef<FileEntryState> & typeof col;
}

const mkSync = (sandbox: any, collection: any) =>
  new FileSync(sandbox, { files: collection }, { destination: "/w", syncMode: "diff" });

const entry = (path: string, content: string): Entry => ({
  name: path,
  state: { path, hash: hashContent(content), updatedAt: "t0" } as FileEntryState,
  content,
});

// ─── Q1 — two Workstreams, ONE shared collection ─────────────────────────────

describe("Q1 shared collection", () => {
  // `it.fails` — these assert the DESIRED behaviour and are expected to FAIL today.
  // Polarity matters: asserting the bug as passing would turn a correct FileSync
  // fix into a red CI run. This way the fix flips `it.fails` to "expected to fail
  // but passed", which is the signal to delete the marker and keep the assertion.
  it.fails("1a — DESIRED: a second flush must not clobber the first's edit", async () => {
    const shared = createCollection([entry("a.ts", "ORIGINAL")]);

    const sbA = createMockSandbox();
    const sbB = createMockSandbox();
    const A = mkSync(sbA, shared);
    const B = mkSync(sbB, shared);

    await A.hydrate();
    await B.hydrate(); // both see ORIGINAL

    sbA.files.set("/w/a.ts", "A-EDIT");
    sbB.files.set("/w/a.ts", "B-EDIT");

    await A.flush();
    const afterA = shared.store.get("a.ts")!.content;
    await B.flush();
    const afterB = shared.store.get("a.ts")!.content;

    console.log(`[q1a] after A=${afterA} · after B=${afterB} · A's edit survived=${afterB === "A-EDIT"}`);
    expect(afterA).toBe("A-EDIT");
    // DESIRED: B is told it conflicts, A's edit stands. TODAY: B clobbers it.
    expect(afterB).toBe("A-EDIT");
  });

  it.fails("1b — DESIRED: B must not delete a file it never hydrated", async () => {
    const shared = createCollection([entry("a.ts", "ORIGINAL")]);

    const sbA = createMockSandbox();
    const sbB = createMockSandbox();
    const A = mkSync(sbA, shared);
    const B = mkSync(sbB, shared);

    await A.hydrate();
    await B.hydrate(); // B's view predates A's new file

    sbA.files.set("/w/new.ts", "A-NEW-FILE");
    await A.flush();
    const existsAfterA = shared.store.has("new.ts");

    await B.flush(); // B never saw new.ts
    const existsAfterB = shared.store.has("new.ts");

    console.log(
      `[q1b] new.ts after A=${existsAfterA} · after B=${existsAfterB} · ` +
        `destroyed-by-absence=${existsAfterA && !existsAfterB} · log=${shared.log.filter((l) => l.startsWith("DELETE")).join(",")}`,
    );
    expect(existsAfterA).toBe(true);
    // DESIRED: new.ts survives. TODAY: B deletes work it never saw.
    expect(existsAfterB).toBe(true);
  });
});

// ─── Q2 — two Workstreams, SEPARATE collections ──────────────────────────────

describe("Q2 separate collections", () => {
  it("2 — is isolation free when each Workstream mounts its own collection?", async () => {
    const colA = createCollection([entry("a.ts", "ORIGINAL")]);
    const colB = createCollection([entry("a.ts", "ORIGINAL")]);

    const sbA = createMockSandbox();
    const sbB = createMockSandbox();
    await mkSync(sbA, colA).hydrate();
    await mkSync(sbB, colB).hydrate();

    sbA.files.set("/w/a.ts", "A-EDIT");
    sbB.files.set("/w/a.ts", "B-EDIT");
    sbA.files.set("/w/onlyA.ts", "A-NEW");

    await mkSync(sbA, colA).flush();
    await mkSync(sbB, colB).flush();

    const deletes = [...colA.log, ...colB.log].filter((l) => l.startsWith("DELETE"));
    console.log(
      `[q2] colA a.ts=${colA.store.get("a.ts")!.content} · colB a.ts=${colB.store.get("a.ts")!.content} · ` +
        `colA onlyA.ts=${colA.store.has("onlyA.ts")} · colB onlyA.ts=${colB.store.has("onlyA.ts")} · deletes=${deletes.length}`,
    );
    expect(colA.store.get("a.ts")!.content).toBe("A-EDIT");
    expect(colB.store.get("a.ts")!.content).toBe("B-EDIT");
    expect(deletes.length).toBe(0);
  });
});

// ─── Q3/Q4 — "detect, don't merge": minimal base-aware flush ─────────────────

/** `ours: null` means our side is a deletion, not an edit. */
type Conflict = { path: string; base: string | null; theirs: string | null; ours: string | null };

/**
 * The whole proposed mechanism. Carries the hydrated hash per path, and:
 *   - writes only when the collection still matches what we hydrated
 *   - reports a conflict instead of clobbering when it doesn't
 *   - deletes ONLY within the hydrated set (no delete-by-absence)
 */
class BaseAwareSync {
  private base = new Map<string, string>(); // path -> hash at hydrate

  constructor(
    private sandbox: any,
    private collection: any,
    private dest = "/w",
  ) {}

  async hydrate(): Promise<void> {
    for (const ref of await this.collection.list()) {
      const content = await ref.readContent();
      if (content === null) continue;
      this.base.set(ref.state.path, ref.state.hash);
      await this.sandbox.writeFile(`${this.dest}/${ref.state.path}`, content);
    }
  }

  async flush(): Promise<{ written: string[]; conflicts: Conflict[]; deleted: string[] }> {
    const written: string[] = [];
    const conflicts: Conflict[] = [];
    const deleted: string[] = [];

    const present = new Set<string>();
    for (const full of this.sandbox.files.keys() as Iterable<string>) {
      if (!full.startsWith(`${this.dest}/`)) continue;
      const p = full.slice(this.dest.length + 1);
      present.add(p);

      const content: string = this.sandbox.files.get(full)!;
      const hash = hashContent(content);
      const existing = await this.collection.getOptional(p);
      const baseHash = this.base.get(p);

      if (existing && existing.state.hash === hash) continue; // unchanged
      if (existing && baseHash !== undefined && existing.state.hash !== baseHash) {
        conflicts.push({
          path: p,
          base: baseHash,
          theirs: await existing.readContent(),
          ours: content,
        });
        continue; // do NOT clobber
      }
      if (existing && baseHash === undefined) {
        conflicts.push({ path: p, base: null, theirs: await existing.readContent(), ours: content });
        continue; // appeared under us
      }
      const ref = await this.collection.getOrCreate(p, { path: p, hash, updatedAt: "t1" });
      await ref.patchState({ hash, updatedAt: "t1" });
      await ref.writeContent(content);
      written.push(p);
    }

    for (const [p, baseHash] of this.base) {
      if (present.has(p)) continue;
      // A delete is a write of "absent", so it needs the same evidence: the
      // collection must still hold what we hydrated. If someone edited the
      // file since, deleting it destroys their work exactly as clobbering
      // would — report the conflict instead (edit-vs-delete).
      const existing = await this.collection.getOptional(p);
      if (existing === undefined) continue; // already gone; nothing to do
      if (existing.state.hash !== baseHash) {
        conflicts.push({
          path: p,
          base: baseHash,
          theirs: await existing.readContent(),
          ours: null, // ours is the deletion
        });
        continue;
      }
      deleted.push(p);
      await this.collection.delete(p);
    }
    return { written, conflicts, deleted };
  }
}

describe("Q3/Q4 detect-don't-merge", () => {
  it("3a — same two-writer edit that lost data in Q1a", async () => {
    const shared = createCollection([entry("a.ts", "ORIGINAL")]);
    const sbA = createMockSandbox();
    const sbB = createMockSandbox();
    const A = new BaseAwareSync(sbA, shared);
    const B = new BaseAwareSync(sbB, shared);

    await A.hydrate();
    await B.hydrate();
    sbA.files.set("/w/a.ts", "A-EDIT");
    sbB.files.set("/w/a.ts", "B-EDIT");

    const rA = await A.flush();
    const rB = await B.flush();

    console.log(
      `[q3a] A written=${rA.written} conflicts=${rA.conflicts.length} · ` +
        `B written=${rB.written} conflicts=${rB.conflicts.length} · stored=${shared.store.get("a.ts")!.content}`,
    );
    expect(rA.written).toEqual(["a.ts"]);
    expect(rB.conflicts).toHaveLength(1);
    expect(shared.store.get("a.ts")!.content).toBe("A-EDIT"); // nothing silently lost
  });

  it("3b — same add-then-flush that destroyed data in Q1b", async () => {
    const shared = createCollection([entry("a.ts", "ORIGINAL")]);
    const sbA = createMockSandbox();
    const sbB = createMockSandbox();
    const A = new BaseAwareSync(sbA, shared);
    const B = new BaseAwareSync(sbB, shared);

    await A.hydrate();
    await B.hydrate();
    sbA.files.set("/w/new.ts", "A-NEW-FILE");
    await A.flush();
    const rB = await B.flush();

    console.log(
      `[q3b] new.ts survives B's flush=${shared.store.has("new.ts")} · B deleted=${JSON.stringify(rB.deleted)}`,
    );
    expect(shared.store.has("new.ts")).toBe(true); // delete-by-absence gone
    expect(rB.deleted).toEqual([]);
  });

  it("3d — edit vs delete: B's delete must not erase A's flushed edit", async () => {
    const shared = createCollection([entry("a.ts", "ORIGINAL")]);
    const sbA = createMockSandbox();
    const sbB = createMockSandbox();
    const A = new BaseAwareSync(sbA, shared);
    const B = new BaseAwareSync(sbB, shared);

    await A.hydrate();
    await B.hydrate(); // both carry a.ts@ORIGINAL as base
    sbA.files.set("/w/a.ts", "A-EDIT");
    sbB.files.delete("/w/a.ts"); // B removes its local copy

    await A.flush(); // a.ts is now A-EDIT in the collection
    const rB = await B.flush(); // B's delete is based on a stale hash

    console.log(
      `[q3d] B deleted=${JSON.stringify(rB.deleted)} conflicts=${rB.conflicts.length} · ` +
        `a.ts survives=${shared.store.has("a.ts")} ` +
        `content=${shared.store.get("a.ts")?.content ?? "GONE"}`,
    );
    // The write path already refuses to clobber a changed file; the delete
    // path must refuse for the same reason and on the same evidence.
    expect(rB.deleted).toEqual([]);
    expect(rB.conflicts).toHaveLength(1);
    expect(shared.store.get("a.ts")?.content).toBe("A-EDIT");
  });

  it("4 — is the conflict report actionable (both versions recoverable)?", async () => {
    const shared = createCollection([entry("a.ts", "ORIGINAL")]);
    const sbA = createMockSandbox();
    const sbB = createMockSandbox();
    const A = new BaseAwareSync(sbA, shared);
    const B = new BaseAwareSync(sbB, shared);

    await A.hydrate();
    await B.hydrate();
    sbA.files.set("/w/a.ts", "A-EDIT");
    sbB.files.set("/w/a.ts", "B-EDIT");
    await A.flush();
    const rB = await B.flush();

    const c = rB.conflicts[0]!;
    console.log(
      `[q4] conflict{path=${c.path} base=${c.base?.slice(0, 8)} theirs=${c.theirs} ours=${c.ours}} · ` +
        `both-recoverable=${c.theirs === "A-EDIT" && c.ours === "B-EDIT"}`,
    );
    expect(c.theirs).toBe("A-EDIT");
    expect(c.ours).toBe("B-EDIT");
  });

  it("3c — a genuine no-op flush stays a no-op (no false conflicts)", async () => {
    const shared = createCollection([entry("a.ts", "ORIGINAL"), entry("b.ts", "B")]);
    const sb = createMockSandbox();
    const S = new BaseAwareSync(sb, shared);
    await S.hydrate();
    const r = await S.flush();
    console.log(`[q3c] written=${r.written.length} conflicts=${r.conflicts.length} deleted=${r.deleted.length}`);
    expect(r).toEqual({ written: [], conflicts: [], deleted: [] });
  });
});
