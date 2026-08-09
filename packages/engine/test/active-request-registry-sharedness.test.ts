/**
 * The request registry's cross-process sharedness declaration (FIX-999).
 *
 * Why this matters, and why the default is the interesting case: the liveness
 * verb answers "is this request still running?" by reading the registry. On a
 * registry whose entries are per-process, another process's healthy request is
 * simply absent, so the read reports live work DEAD — and a consumer that
 * re-dispatches on that answer runs the work twice.
 *
 * The registry advertised nothing about this, which is why the signal was
 * previously judged unimplementable. These tests pin the declaration and, more
 * importantly, pin that it FAILS CLOSED: an adapter that says nothing gets
 * liveness refused rather than silently wrong. A third-party registry compiled
 * against the old contract must land in the refused bucket, not the trusted one.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInMemoryActiveRequestRegistry } from "../src/stores/memory/active-request-registry";
import { createFilesystemActiveRequestRegistry } from "../src/stores/filesystem/active-request-registry";
import { isRegistrySharedAcrossProcesses } from "../src/stores/shared";
import type { ActiveRequestRegistry } from "../src/stores/types";

describe("ActiveRequestRegistry sharedness declaration", () => {
  it("treats an undeclared registry as NOT shared, so liveness is refused rather than wrong", () => {
    // An out-of-tree adapter compiled against the pre-FIX-999 contract. It
    // declares nothing; the reader must not mistake `undefined` for `true`.
    const legacy = {
      register: async () => {},
      heartbeat: async () => {},
      deregister: async () => {},
      listStale: async () => [],
      listAll: async () => [],
      get: async () => undefined
    } as ActiveRequestRegistry;

    expect(legacy.sharedAcrossProcesses).toBeUndefined();
    expect(isRegistrySharedAcrossProcesses(legacy)).toBe(false);
  });

  it("reads an explicit false as not shared", () => {
    const declared = {
      sharedAcrossProcesses: false,
      register: async () => {},
      heartbeat: async () => {},
      deregister: async () => {},
      listStale: async () => [],
      listAll: async () => [],
      get: async () => undefined
    } as ActiveRequestRegistry;

    expect(isRegistrySharedAcrossProcesses(declared)).toBe(false);
  });

  it("reads an explicit true as shared", () => {
    const declared = {
      sharedAcrossProcesses: true,
      register: async () => {},
      heartbeat: async () => {},
      deregister: async () => {},
      listStale: async () => [],
      listAll: async () => [],
      get: async () => undefined
    } as ActiveRequestRegistry;

    expect(isRegistrySharedAcrossProcesses(declared)).toBe(true);
  });

  it("in-memory declares NOT shared — the shipped default, and the reason the gate refuses out of the box", () => {
    const registry = createInMemoryActiveRequestRegistry();
    expect(registry.sharedAcrossProcesses).toBe(false);
    expect(isRegistrySharedAcrossProcesses(registry)).toBe(false);
  });

  it("filesystem declares NOT shared — it cannot tell a shared volume from a per-process temp dir", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fsd-registry-"));
    const registry = createFilesystemActiveRequestRegistry({ directory });
    expect(registry.sharedAcrossProcesses).toBe(false);
    expect(isRegistrySharedAcrossProcesses(registry)).toBe(false);
  });
});
