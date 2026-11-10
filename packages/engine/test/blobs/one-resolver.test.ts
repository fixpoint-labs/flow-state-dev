/**
 * ER-1 (epic FIX-2516): one resolver turns a reference into bytes, and nothing
 * else reads `fsd-blob:` by hand. The resolver serves a reference only to the
 * conversation that owns the file, so a reference copied into another
 * conversation reads nothing there.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { AttachmentUnavailableError, resolveAttachment, sessionBlobOwner } from "../../src/blobs/attachments";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { newBlobId } from "../../src/blobs/shared";

const ALICE = { userId: "alice", orgId: "acme" };

describe("resolveAttachment", () => {
  it("turns a reference into its bytes for the owning conversation", async () => {
    const blobs = createMemoryBlobStore();
    const id = newBlobId();
    const bytes = new Uint8Array([104, 105]);
    await blobs.put({ id, bytes, mediaType: "image/png", uploader: ALICE });
    await blobs.claim(id, { uploader: ALICE, owner: sessionBlobOwner("s1"), send: "send-1" });
    const file = { type: "file" as const, mediaType: "image/png", data: toBlobRef(id) };
    const resolved = await resolveAttachment(blobs, file, { owner: sessionBlobOwner("s1"), user: ALICE });
    expect(resolved.bytes).toEqual(bytes);
    expect(resolved.base64()).toBe("aGk=");
  });

  it("refuses a reference another conversation owns, an unclaimed one, and data that is no reference", async () => {
    const blobs = createMemoryBlobStore();
    const id = newBlobId();
    await blobs.put({ id, bytes: new Uint8Array([1]), mediaType: "image/png", uploader: ALICE });
    const file = { type: "file" as const, mediaType: "image/png", data: toBlobRef(id) };
    await expect(resolveAttachment(blobs, file, { owner: sessionBlobOwner("s1"), user: ALICE })).rejects.toBeInstanceOf(AttachmentUnavailableError);
    await blobs.claim(id, { uploader: ALICE, owner: sessionBlobOwner("s1"), send: "send-1" });
    await expect(resolveAttachment(blobs, file, { owner: sessionBlobOwner("s2"), user: ALICE })).rejects.toBeInstanceOf(AttachmentUnavailableError);
    await expect(
      resolveAttachment(blobs, { ...file, data: "aGk=" }, { owner: sessionBlobOwner("s1"), user: ALICE })
    ).rejects.toBeInstanceOf(AttachmentUnavailableError);
  });
});

/** Every `.ts`/`.tsx` source file under `packages/<name>/src`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the one place a reference is read", () => {
  it("has no source file but the contracts helper write the scheme in code", () => {
    const packages = path.resolve(__dirname, "../../..");
    const helper = path.join(packages, "contracts", "src", "attachments.ts");
    const offenders: string[] = [];
    let scanned = 0;
    for (const pkg of readdirSync(packages)) {
      const src = path.join(packages, pkg, "src");
      if (!statSync(path.join(packages, pkg)).isDirectory()) continue;
      let files: string[];
      try {
        files = sourceFiles(src);
      } catch {
        continue;
      }
      for (const file of files) {
        scanned += 1;
        if (file === helper) continue;
        // Code, not prose: a string or template literal that holds the scheme.
        const code = readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
          .join("\n");
        if (/["'`]fsd-blob:/.test(code)) offenders.push(path.relative(packages, file));
      }
    }
    // The scan read the tree: the helper itself is one of the files it saw.
    expect(scanned).toBeGreaterThan(100);
    expect(readFileSync(helper, "utf8")).toMatch(/["'`]fsd-blob:/);
    expect(offenders).toEqual([]);
  });
});
