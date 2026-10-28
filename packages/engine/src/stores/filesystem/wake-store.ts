/**
 * Filesystem-backed WakeStore (FIX-2078 D1): one JSON file per wake, at
 * rootDir/{encodeURIComponent(key)}.json.
 *
 * The filesystem store is development-only and single-process, so every
 * operation runs on one in-process chain: a read-modify-write never
 * interleaves with another, which is what makes the coalescing and the
 * version-conditional move and clear hold.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WakeInput, WakeKey, WakeRecord, WakeStore } from "../types";
import { coalesceWake, wakeStorageKey } from "../memory/wake-store";

class FilesystemWakeStore implements WakeStore {
  private readonly rootDir: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private filePath(key: WakeKey): string {
    return path.join(this.rootDir, `${encodeURIComponent(wakeStorageKey(key))}.json`);
  }

  /** Run `fn` after every operation already queued, never beside one. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async read(file: string): Promise<WakeRecord | null> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as WakeRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async write(file: string, record: WakeRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(record), "utf8");
    await rename(temp, file);
  }

  private async all(): Promise<WakeRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.rootDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map((name) => this.read(path.join(this.rootDir, name)))
    );
    return records.filter((record): record is WakeRecord => record !== null);
  }

  owe(input: WakeInput): Promise<WakeRecord> {
    return this.serial(async () => {
      const file = this.filePath(input);
      const next = coalesceWake(await this.read(file), input, Date.now());
      await this.write(file, next);
      return next;
    });
  }

  get(key: WakeKey): Promise<WakeRecord | null> {
    return this.serial(() => this.read(this.filePath(key)));
  }

  move(key: WakeKey, version: number, dueAt: number): Promise<boolean> {
    return this.serial(async () => {
      const file = this.filePath(key);
      const found = await this.read(file);
      if (found === null || found.version !== version) return false;
      await this.write(file, { ...found, dueAt, updatedAt: Date.now() });
      return true;
    });
  }

  clear(key: WakeKey, version: number): Promise<boolean> {
    return this.serial(async () => {
      const file = this.filePath(key);
      const found = await this.read(file);
      if (found === null || found.version !== version) return false;
      await rm(file, { force: true });
      return true;
    });
  }

  listDue(now: number, limit: number): Promise<WakeRecord[]> {
    return this.serial(async () =>
      (await this.all())
        .filter((wake) => wake.dueAt <= now)
        .sort((a, b) => a.dueAt - b.dueAt)
        .slice(0, limit)
    );
  }

  earliestDueAt(): Promise<number | null> {
    return this.serial(async () => {
      const records = await this.all();
      return records.length === 0 ? null : Math.min(...records.map((wake) => wake.dueAt));
    });
  }
}

export function createFilesystemWakeStore(rootDir: string): WakeStore {
  return new FilesystemWakeStore(rootDir);
}
