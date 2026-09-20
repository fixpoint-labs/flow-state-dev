/**
 * The index capability is optional. On: search tool is present. Off: empty.
 */
import { describe, expect, it } from "vitest";
import {
  SEARCH_INDEXED_DOCUMENTS_TOOL,
  createSystemOneIndexCapability,
  systemOneIndexTools,
} from "../src/index-capability";
import { INDEXED_DOCS, indexedDocsCollection } from "../src/indexed-docs-resource";
import { BILLING_RESULT, scriptedClient } from "./scripted-client";

describe("createSystemOneIndexCapability", () => {
  it("installs the collection and the facet search tool", () => {
    const { client } = scriptedClient(BILLING_RESULT);
    const cap = createSystemOneIndexCapability({ client });
    expect(cap.name).toBe("system-one-index");
    expect(cap.collectionKey).toBe(INDEXED_DOCS);
    expect(cap.collection).toBe(indexedDocsCollection);
    expect(cap.searchTool.name).toBe(SEARCH_INDEXED_DOCUMENTS_TOOL);
    expect(systemOneIndexTools(cap).map((tool) => tool.name)).toEqual([
      SEARCH_INDEXED_DOCUMENTS_TOOL,
    ]);
  });

  it("returns no tools when the capability was never created", () => {
    expect(systemOneIndexTools(undefined)).toEqual([]);
    expect(systemOneIndexTools(null)).toEqual([]);
  });
});
