/**
 * The filesystem adapter under a fenced session address (FIX-1000).
 *
 * The generation is invisible to SQLite and Postgres — `scope_id` is
 * `TEXT NOT NULL` and a string got longer. The filesystem adapter is the one
 * place where the address is a real artifact: `scopeDir()` maps a scope id to
 * `<root>/<subdir>/session/<encodeURIComponent(scopeId)>`, so a generation
 * becomes part of a directory *name*. Two things follow that nothing else in
 * the suite checks — that two generations of one session id are two separate
 * directories (so purging one leaves the other whole), and that the extra bytes
 * still fit the 255-byte filesystem segment limit.
 *
 * The purge asymmetry between the two stores is deliberate upstream and is
 * asserted as-is rather than smoothed over: `ContentStore.deleteAll` removes
 * the directory, while `ResourceStateStore.deleteAll` enumerates and *marks*
 * (a scope purge must retain each key's version, FIX-992), so its directory
 * survives holding tombstones. Reclaiming those is FIX-1030, split out
 * deliberately — this file pins today's behaviour so that follow-up has a
 * baseline to change.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFilesystemStores, resolveSessionResourceScopeId } from "../../../src";
import type { StoreRegistry } from "../../../src/stores/types";

const SESSION_ID = "user-123-main";

let root: string;
let stores: StoreRegistry;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-gen-dirs-"));
  stores = createFilesystemStores({ rootDir: root, developmentOnly: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** On-disk directory a session-scope address maps to, per `subdir`. */
function scopeDir(subdir: "content" | "state", scopeId: string): string {
  return path.join(root, subdir, "session", encodeURIComponent(scopeId));
}

function exists(dir: string): boolean {
  return fs.existsSync(dir);
}

/** Write one state row and one content row at `scopeId`. */
async function write(scopeId: string, key: string, body: string): Promise<void> {
  await stores.resourceState.set("session", scopeId, key, { title: body }, "any");
  await stores.content.set("session", scopeId, key, body);
}

describe("FIX-1000 on the filesystem adapter", () => {
  it("two generations of one session id are two directories", async () => {
    const first = resolveSessionResourceScopeId({ id: SESSION_ID, storageGeneration: "gen-one" });
    const second = resolveSessionResourceScopeId({ id: SESSION_ID, storageGeneration: "gen-two" });

    await write(first, "notes/a", "from-first");
    await write(second, "notes/a", "from-second");

    expect(scopeDir("content", first)).not.toBe(scopeDir("content", second));
    expect(exists(scopeDir("content", first))).toBe(true);
    expect(exists(scopeDir("content", second))).toBe(true);
    // Same key, two generations, no collision — the property the fence rests on.
    expect(await stores.content.get("session", first, "notes/a")).toBe("from-first");
    expect(await stores.content.get("session", second, "notes/a")).toBe("from-second");
  });

  it("purging one generation removes its content directory and leaves the survivor whole", async () => {
    const dead = resolveSessionResourceScopeId({ id: SESSION_ID, storageGeneration: "gen-dead" });
    const live = resolveSessionResourceScopeId({ id: SESSION_ID, storageGeneration: "gen-live" });

    await write(dead, "notes/a", "doomed");
    await write(live, "notes/a", "kept");

    // What `handleDeleteSession` does, at the store layer it does it at.
    await stores.content.deleteAll("session", dead);
    await stores.resourceState.deleteAll("session", dead);

    expect(exists(scopeDir("content", dead))).toBe(false);
    expect(exists(scopeDir("content", live))).toBe(true);
    expect(await stores.content.get("session", live, "notes/a")).toBe("kept");
    expect(await stores.resourceState.get("session", live, "notes/a")).toBeDefined();

    // The state store marks rather than removes, so its directory survives the
    // purge holding tombstones. Not a leak the fence cares about — nothing can
    // address it again — but it is unreclaimed until FIX-1030.
    expect(exists(scopeDir("state", dead))).toBe(true);
    expect(await stores.resourceState.get("session", dead, "notes/a")).toBeUndefined();
  });

  it("the bare id is untouched by a purge of a generation under it", async () => {
    // A legacy record's rows live at the bare id. Purging a fenced generation
    // must not reach them — the directory names are siblings, not nested.
    const fenced = resolveSessionResourceScopeId({ id: SESSION_ID, storageGeneration: "gen-x" });

    await write(SESSION_ID, "notes/legacy", "legacy-body");
    await write(fenced, "notes/a", "fenced-body");

    await stores.content.deleteAll("session", fenced);
    await stores.resourceState.deleteAll("session", fenced);

    expect(exists(scopeDir("content", SESSION_ID))).toBe(true);
    expect(await stores.content.get("session", SESSION_ID, "notes/legacy")).toBe("legacy-body");
    expect(await stores.resourceState.get("session", SESSION_ID, "notes/legacy")).toBeDefined();
  });

  it("a long session id plus a generation stays inside the 255-byte segment limit", async () => {
    // The generation narrows existing headroom; it does not create the limit.
    // A UUID plus the encoded separator is a fixed 39-byte cost
    // (`%23` + 36), so the practical bound on a caller-supplied id drops from
    // 255 to 216 bytes. 200 is a generous natural key — an email, a tenant
    // slug, a composite — and must still fit.
    const longId = "s".repeat(200);
    const generation = "b3708376-4f54-4204-acef-c044d9211167";
    const fenced = resolveSessionResourceScopeId({ id: longId, storageGeneration: generation });

    const segment = encodeURIComponent(fenced);
    expect(Buffer.byteLength(segment, "utf8")).toBeLessThanOrEqual(255);
    // Pin the cost so a separator change that inflates it (a multi-byte
    // character, say) fails here rather than as an ENAMETOOLONG in someone's
    // deployment.
    expect(Buffer.byteLength(segment, "utf8") - longId.length).toBe(39);

    // And it actually writes — the byte arithmetic above is a claim about the
    // filesystem, so make the filesystem answer it.
    await write(fenced, "notes/a", "long-id-body");
    expect(await stores.content.get("session", fenced, "notes/a")).toBe("long-id-body");
    expect(exists(scopeDir("content", fenced))).toBe(true);
  });

  it("a generation never produces a scope id the adapter rejects", async () => {
    // `validateScopeId` refuses "", ".", ".." and Windows reserved names. A
    // UUID cannot be any of those, and appending to a valid id cannot make it
    // one — but the id is caller-supplied, so assert the composed result rather
    // than reasoning about it.
    for (const id of ["a", "CON", "..", "."]) {
      const fenced = resolveSessionResourceScopeId({
        id,
        storageGeneration: "b3708376-4f54-4204-acef-c044d9211167"
      });
      await expect(write(fenced, "notes/a", "body")).resolves.toBeUndefined();
    }
  });
});
