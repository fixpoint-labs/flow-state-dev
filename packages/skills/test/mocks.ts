/**
 * Shared test helpers — a minimal mock `ResourceCollectionRef` good enough
 * for the skills package. State is just a JSON object; content is a string
 * or null. Pattern matching is approximated (the skills code only ever
 * walks names ending in `/SKILL.md`).
 */
import { vi } from "vitest";
import type {
  ResourceCollectionRef,
  ResourceRef,
} from "@flow-state-dev/core/types";

interface MockEntry {
  name: string;
  state: Record<string, unknown>;
  content: string | null;
}

export function createMockSkillsCollection(
  pattern = "skills/**",
): ResourceCollectionRef & { _store: Map<string, MockEntry> } {
  const store = new Map<string, MockEntry>();

  const makeRef = (entry: MockEntry): ResourceRef => ({
    name: entry.name,
    scope: "project" as const,
    state: entry.state as never,
    patchState: vi.fn(async (updates: Record<string, unknown>) => {
      entry.state = { ...entry.state, ...updates };
    }) as never,
    setState: vi.fn(async (next: Record<string, unknown>) => {
      entry.state = { ...next };
    }) as never,
    updateState: vi.fn(async (updater: (s: Record<string, unknown>) => Record<string, unknown>) => {
      entry.state = await updater(entry.state);
    }) as never,
    readContent: vi.fn(async () => entry.content),
    readContentRaw: vi.fn(async () => entry.content),
    writeContent: vi.fn(async (content: string) => {
      entry.content = content;
    }),
    config: { stateSchema: {} as never },
  } as unknown as ResourceRef);

  const ref: ResourceCollectionRef & { _store: Map<string, MockEntry> } = {
    pattern,
    scope: "project" as const,
    get(key) {
      const k = typeof key === "string" ? key : "";
      const entry = store.get(prefixed(pattern, k));
      if (!entry) throw new Error(`Not found: ${k}`);
      return makeRef(entry);
    },
    getOptional(key) {
      const k = typeof key === "string" ? key : "";
      const entry = store.get(prefixed(pattern, k));
      return entry ? makeRef(entry) : undefined;
    },
    create: vi.fn(async (key, initial) => {
      const k = typeof key === "string" ? key : "";
      const full = prefixed(pattern, k);
      if (store.has(full)) throw new Error(`Already exists: ${full}`);
      const entry: MockEntry = {
        name: full,
        state: { ...(initial as Record<string, unknown> | undefined) },
        content: null,
      };
      store.set(full, entry);
      return makeRef(entry);
    }) as never,
    getOrCreate: vi.fn(async (key, initial) => {
      const k = typeof key === "string" ? key : "";
      const full = prefixed(pattern, k);
      let entry = store.get(full);
      if (!entry) {
        entry = {
          name: full,
          state: { ...(initial as Record<string, unknown> | undefined) },
          content: null,
        };
        store.set(full, entry);
      }
      return makeRef(entry);
    }) as never,
    list() {
      return Array.from(store.values()).map(makeRef);
    },
    delete: vi.fn(async (key) => {
      const k = typeof key === "string" ? key : "";
      store.delete(prefixed(pattern, k));
    }) as never,
    count() {
      return store.size;
    },
    config: { pattern, stateSchema: {} as never } as never,
    _store: store,
  };

  return ref;
}

function prefixed(pattern: string, key: string): string {
  // pattern like "skills/**" → prefix is "skills"
  const prefix = pattern.replace(/\/\*\*$/, "");
  if (key.startsWith(prefix + "/")) return key;
  return `${prefix}/${key}`;
}
