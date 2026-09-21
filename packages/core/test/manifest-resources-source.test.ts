/**
 * The resources domain's projection into the discovery door (FIX-817).
 *
 * Two things are load-bearing here and neither is about formatting:
 *
 *   - a collection nobody marked readable is not merely filtered out of the
 *     answer, it is never enumerated to find that out (BR-8); and
 *   - a readable collection that happens to be externally backed is NOT
 *     dropped (BR-8a) — `collectReadableResources` cannot reach those, and a
 *     manifest that lies by omission is worse than no manifest.
 */

import { describe, it, expect, vi } from "vitest";
import { resourcesManifestSource } from "../src/manifest/resources-source";
import { createManifestRegistry } from "../src/manifest/registry";
import { discoveryTools } from "../src/manifest/discovery-tools";
import { resourceTools } from "../src/tools/resource-tools";
import type { BlockContext } from "../src/types/block";
import { createMockContext, runForTest } from "./helpers";

function instance(path: string, config: Record<string, unknown> = {}) {
  return {
    path,
    scope: "org",
    uri: `org/${path}`,
    state: {},
    config: { llmReadable: true, ...config },
    readContent: async () => null,
    readContentRaw: async () => null,
  };
}

function ctxOf(entries: unknown[]): BlockContext {
  return createMockContext({
    resources: { list: () => entries, get: (() => undefined) as any } as any,
  });
}

const source = resourcesManifestSource();

describe("resourcesManifestSource", () => {
  // BR-8. The assertion that matters is the spy, not the absence: a lazy or
  // broken collection must not be bulk-loaded just to discover it was never
  // allowed to be read.
  it("skips a non-readable collection before listing it", async () => {
    const secret = vi.fn(async () => [instance("private/keys")]);
    const open = vi.fn(async () => [instance("notes/standup")]);

    const entries = await source.entries(
      ctxOf([
        { pattern: "private/**", scope: "org", config: { llmReadable: false }, create: async () => {}, list: secret },
        { pattern: "notes/**", scope: "org", config: { llmReadable: true }, create: async () => {}, list: open },
      ]),
    );

    expect(entries.map((e) => e.id)).toEqual(["org/notes/standup"]);
    expect(secret).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
  });

  it("omits a static resource that did not opt into llmReadable", async () => {
    const entries = await source.entries(
      ctxOf([instance("soul", { llmReadable: false }), instance("charter")]),
    );

    expect(entries.map((e) => e.id)).toEqual(["org/charter"]);
  });

  // BR-8a. External collections are classified out of `collectCollections` by
  // their `external` brand, so a source built on the readable helper alone
  // would report an in-scope resource as absent.
  it("includes a readable external collection, as one entry rather than its rows", async () => {
    const listed = vi.fn(async () => ({ items: [], nextCursor: undefined }));
    const entries = await source.entries(
      ctxOf([
        {
          pattern: "docs/**",
          scope: "org",
          external: true,
          config: { llmReadable: true },
          list: listed,
        },
      ]),
    );

    expect(entries).toEqual([
      {
        id: "org/docs/**",
        kind: "collection",
        purpose: "Readable collection of resources under docs/**",
        contract: "Search it to get uris, then read those uris. Not enumerable up front.",
      },
    ]);
    // Read-through and paged by design — enumerating it to build a catalog is
    // the thing its laziness exists to avoid.
    expect(listed).not.toHaveBeenCalled();
  });

  it("omits a non-readable external collection", async () => {
    const entries = await source.entries(
      ctxOf([
        { pattern: "vault/**", scope: "org", external: true, config: { llmReadable: false }, list: async () => ({ items: [] }) },
      ]),
    );

    expect(entries).toEqual([]);
  });

  // The purpose line is what an agent chooses on, so a declared description
  // beats the address it would otherwise fall back to.
  it("prefers a declared description over the resource's address", async () => {
    const entries = await source.entries(
      ctxOf([
        instance("charter", { metadata: { description: "The team's standing agreement." } }),
        instance("notes/raw"),
      ]),
    );

    expect(entries.find((e) => e.id === "org/charter")!.purpose).toBe(
      "The team's standing agreement.",
    );
    expect(entries.find((e) => e.id === "org/notes/raw")!.purpose).toBe(
      "Readable resource at notes/raw",
    );
  });

  it("says in the contract hint whether the agent may write, not only read", async () => {
    const entries = await source.entries(
      ctxOf([instance("scratch", { llmWritable: true }), instance("charter")]),
    );

    expect(entries.find((e) => e.id === "org/scratch")!.contract).toContain("read and write");
    expect(entries.find((e) => e.id === "org/charter")!.contract).toContain("you may read");
  });

  it("reaches an agent through the door under the resources domain", async () => {
    const { discover } = discoveryTools(createManifestRegistry([source]));

    const result = await runForTest(
      discover,
      { domain: "resources", detail: "thin" },
      ctxOf([instance("charter")]),
    );

    expect(result.domains).toEqual([
      {
        domain: "resources",
        entries: [{ id: "org/charter", kind: "resource", purpose: "Readable resource at charter" }],
      },
    ]);
  });
});

// BR-17. The ungated full-state enumerator the door replaces. It had no caller
// anywhere in the repository, so removing it breaks nothing — the census under
// specs/issues/FIX-817/poc/ re-derives that claim across the tree.
describe("resourceTools", () => {
  it("no longer offers listResources", () => {
    expect(Object.keys(resourceTools()).sort()).toEqual([
      "createResource",
      "deleteResource",
      "readResource",
      "updateResource",
    ]);
  });
});
