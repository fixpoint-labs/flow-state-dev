import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilesystemStores } from "../src";

/**
 * FIX-406 6A: the filesystem store's O(N^2) event persistence is a production
 * footgun. Constructing it without acknowledging `developmentOnly: true` logs
 * a one-time warning steering operators toward SQLite. The flag is an explicit
 * acknowledgement, not a behavior switch.
 */
describe("createFilesystemStores developmentOnly warning", () => {
  let scratch: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "fsd-devonly-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await rm(scratch, { recursive: true, force: true });
  });

  it("warns once when developmentOnly is not acknowledged, and never with the flag", () => {
    // Acknowledged: no warning, and the once-flag stays unset.
    createFilesystemStores({ rootDir: path.join(scratch, "a"), developmentOnly: true });
    expect(warnSpy).not.toHaveBeenCalled();

    // Unacknowledged: warns on the first construction, deduped thereafter.
    createFilesystemStores({ rootDir: path.join(scratch, "b") });
    createFilesystemStores({ rootDir: path.join(scratch, "c") });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/filesystem store/i);
  });
});
