/**
 * `GET /api/flows/debug/storage`, the DevTool header's store-size readout,
 * through the real router: the store answers its own size, the router carries
 * the reading through `resolveStores`, the debug gate holds, and a store that
 * can't measure answers `null` rather than a number. Also the filesystem
 * store's reading against the bytes actually on disk.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFlowApiRouter, createFlowRegistry } from "../src";
import { createFilesystemStores, createInMemoryStores } from "../src/host";
import type { StoreRegistry } from "../src";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "fsd-storage-size-"));
  dirs.push(dir);
  return dir;
}

function getStorage(
  stores: StoreRegistry,
  options: { enabled?: boolean; origin?: string } = {}
): Promise<Response> {
  const router = createFlowApiRouter({
    registry: createFlowRegistry(),
    stores,
    debugEndpointsEnabled: options.enabled ?? true,
    debugAllowAnonymousLocal: true
  });
  return router.GET(
    new Request("http://localhost/api/flows/debug/storage", {
      headers: options.origin === undefined ? {} : { origin: options.origin }
    }),
    { params: { path: ["debug", "storage"] } }
  );
}

describe("filesystem store size", () => {
  it("is the bytes of every file under its root, nested folders included", async () => {
    const root = await tempDir();
    await mkdir(path.join(root, "sessions", "deep"), { recursive: true });
    await writeFile(path.join(root, "sessions", "a.json"), "x".repeat(100));
    await writeFile(path.join(root, "sessions", "deep", "b.json"), "y".repeat(23));
    await writeFile(path.join(root, "top.json"), "z".repeat(7));

    const stores = createFilesystemStores({ rootDir: root, developmentOnly: true });

    expect(await stores.storageSize?.()).toEqual({ kind: "filesystem", bytes: 130, location: path.resolve(root) });
  });

  it("counts a symbolic link as itself, never the folder it points at", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(path.join(outside, "big.bin"), Buffer.alloc(50_000));
    await writeFile(path.join(root, "a.json"), "x".repeat(10));
    await symlink(outside, path.join(root, "link"));

    const stores = createFilesystemStores({ rootDir: root, developmentOnly: true });
    const reading = await stores.storageSize?.();

    expect(reading?.bytes).toBeGreaterThanOrEqual(10);
    expect(reading?.bytes).toBeLessThan(50_000);
  });

  it("measures 0 before the root folder exists", async () => {
    const root = path.join(await tempDir(), "not-yet");
    const stores = createFilesystemStores({ rootDir: root, developmentOnly: true });

    expect((await stores.storageSize?.())?.bytes).toBe(0);
  });

  it("grows when the store writes", async () => {
    const root = await tempDir();
    const stores = createFilesystemStores({ rootDir: root, developmentOnly: true });
    const before = (await stores.storageSize!()).bytes;
    const now = Date.now();
    await stores.session.set(
      "sess_1",
      { id: "sess_1", flowKind: "f", userId: "u", orgId: "o", state: {}, version: 0, createdAt: now, updatedAt: now, journal: [] },
      "any"
    );

    expect((await stores.storageSize!()).bytes).toBeGreaterThan(before);
  });
});

describe("GET /api/flows/debug/storage", () => {
  it("answers the store's own reading, carried through the router's store resolution", async () => {
    const root = await tempDir();
    await writeFile(path.join(root, "a.json"), "x".repeat(42));
    const res = await getStorage(createFilesystemStores({ rootDir: root, developmentOnly: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      storage: { kind: "filesystem", bytes: 42, location: path.resolve(root) }
    });
  });

  it("answers null for a store that can't measure itself, never a made-up number", async () => {
    const res = await getStorage(createInMemoryStores());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ storage: null });
  });

  it("is closed when the debug endpoints are off", async () => {
    const res = await getStorage(createInMemoryStores(), { enabled: false });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "debug_endpoints_disabled" });
  });

  it("refuses a non-loopback origin", async () => {
    const res = await getStorage(createInMemoryStores(), { origin: "https://evil.example" });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("debug_endpoints_origin_rejected");
  });
});
