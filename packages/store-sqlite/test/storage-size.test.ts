/**
 * The SQLite store's size reading against a real database file: it counts the
 * main file and the `-wal` / `-shm` files WAL mode keeps beside it (committed
 * pages can sit in the WAL until a checkpoint), and an in-memory database
 * offers no reading at all.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src/registry";

const opened: SQLiteStoreRegistry[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const stores of opened.splice(0)) stores.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function openTemp(): { stores: SQLiteStoreRegistry; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "fsd-sqlite-size-"));
  dirs.push(dir);
  const file = path.join(dir, "flowstate.db");
  const stores = createSQLiteStores({ filename: file });
  opened.push(stores);
  return { stores, file };
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

async function writeSession(stores: SQLiteStoreRegistry, id: string): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    id,
    { id, flowKind: "f", userId: "u", orgId: "o", state: { pad: "x".repeat(20_000) }, version: 0, createdAt: now, updatedAt: now, journal: [] },
    "any"
  );
}

describe("SQLite storageSize", () => {
  it("is the main file plus its -wal and -shm files", async () => {
    const { stores, file } = openTemp();
    await writeSession(stores, "sess_1");

    // The write sits in the WAL until a checkpoint, so the WAL is non-empty
    // here and a reading of the main file alone would miss it.
    expect(sizeOf(`${file}-wal`)).toBeGreaterThan(0);
    const reading = await stores.storageSize!();

    expect(reading).toEqual({
      kind: "sqlite",
      bytes: sizeOf(file) + sizeOf(`${file}-wal`) + sizeOf(`${file}-shm`),
      location: path.resolve(file)
    });
    expect(reading.bytes).toBeGreaterThan(sizeOf(file));
  });

  it("grows as the store writes", async () => {
    const { stores } = openTemp();
    const before = (await stores.storageSize!()).bytes;
    await writeSession(stores, "sess_1");
    await writeSession(stores, "sess_2");

    expect((await stores.storageSize!()).bytes).toBeGreaterThan(before);
  });

  it("offers no reading for an in-memory database", () => {
    const stores = createSQLiteStores({ filename: ":memory:" });
    opened.push(stores);

    expect(stores.storageSize).toBeUndefined();
  });
});
