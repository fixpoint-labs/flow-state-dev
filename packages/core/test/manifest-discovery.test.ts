/**
 * The discovery door and its registry (FIX-817).
 *
 * What these tests are defending: an orchestrator plans against this answer, so
 * the door must (a) never reach past the scope it was built with, and (b) never
 * cost the agent its turn. Every failure mode below degrades to a partial
 * answer the model can act on; the only loud failure is at declaration time.
 */

import { describe, it, expect } from "vitest";
import type { ManifestEntry } from "@flow-state-dev/contracts";
import { createManifestRegistry, type BlockManifestSource } from "../src/manifest/registry";
import { discoveryTools } from "../src/manifest/discovery-tools";
import { createMockContext, runForTest } from "./helpers";

const ctx = createMockContext();

function sourceOf(
  domain: BlockManifestSource["domain"],
  entries: ManifestEntry[] | (() => never),
  origin?: string,
): BlockManifestSource {
  return {
    domain,
    ...(origin === undefined ? {} : { origin }),
    entries: typeof entries === "function" ? entries : () => entries,
  };
}

const seat = (id: string): ManifestEntry => ({
  id,
  kind: "seat",
  purpose: `Reviews ${id} work.`,
  contract: `Hand it a task naming ${id}.`,
});

describe("createManifestRegistry", () => {
  // BR-6. A domain claimed twice is ambiguous forever after, and the two sites
  // are only both visible here — at the first read, one has already won.
  it("refuses two sources for one domain, naming both registration sites", () => {
    expect(() =>
      createManifestRegistry([
        sourceOf("seats", [], "createWorkforceCapability"),
        sourceOf("seats", [], "myAppRoster"),
      ]),
    ).toThrowError(/"seats".*createWorkforceCapability.*myAppRoster/s);
  });

  it("names an unlabelled site rather than printing undefined", () => {
    expect(() => createManifestRegistry([sourceOf("skills", []), sourceOf("skills", [])])).toThrowError(
      /an unnamed registration site/,
    );
  });

  it("reports the domains it carries in the canonical order, not registration order", () => {
    const registry = createManifestRegistry([
      sourceOf("resources", []),
      sourceOf("seats", []),
    ]);
    expect(registry.domains()).toEqual(["seats", "resources"]);
  });
});

describe("discover", () => {
  // BR-1
  it("returns every domain the scope carries when no domain is named", async () => {
    const { discover } = discoveryTools(
      createManifestRegistry([
        sourceOf("skills", [{ id: "refactor", kind: "skill", purpose: "Rewrites a module." }]),
        sourceOf("seats", [seat("reviewer")]),
      ]),
    );

    const result = await runForTest(discover, { domain: null, detail: "thin" }, ctx);

    expect(result.domains.map((d) => d.domain)).toEqual(["seats", "skills"]);
    expect(result.problem).toBeUndefined();
  });

  it("orders entries by id, so two identical scopes read identically", async () => {
    const { discover } = discoveryTools(
      createManifestRegistry([sourceOf("seats", [seat("zoe"), seat("adam"), seat("mia")])]),
    );

    const result = await runForTest(discover, { domain: "seats", detail: "thin" }, ctx);

    expect(result.domains[0]!.entries.map((e) => e.id)).toEqual(["adam", "mia", "zoe"]);
  });

  // BR-2
  it("returns only the named domain", async () => {
    const { discover } = discoveryTools(
      createManifestRegistry([
        sourceOf("seats", [seat("reviewer")]),
        sourceOf("skills", [{ id: "refactor", kind: "skill", purpose: "Rewrites a module." }]),
      ]),
    );

    const result = await runForTest(discover, { domain: "skills", detail: "thin" }, ctx);

    expect(result.domains.map((d) => d.domain)).toEqual(["skills"]);
  });

  // BR-3. A workforce with no channels registered yet is an ordinary state, and
  // the model should read it as "nothing here" rather than as a fault.
  it("answers a scope-less domain with an empty list, not an error", async () => {
    const { discover } = discoveryTools(createManifestRegistry([sourceOf("seats", [seat("reviewer")])]));

    const result = await runForTest(discover, { domain: "channels", detail: "thin" }, ctx);

    expect(result.domains).toEqual([{ domain: "channels", entries: [] }]);
    expect(result.problem).toBeUndefined();
  });

  // BR-11's mechanism, checked at this altitude: the tool holds only what the
  // registry holds, so there is no wider list for a model-supplied `domain` to
  // filter down from (BP-031). A seat's own `discover:` narrowing rides on top.
  it("cannot reach a domain the registry was not built with", async () => {
    const outOfScope = sourceOf("channels", [{ id: "ops", kind: "channel", purpose: "Ops chatter." }]);
    const { discover } = discoveryTools(createManifestRegistry([sourceOf("seats", [seat("reviewer")])]));

    const asked = await runForTest(discover, { domain: "channels", detail: "full" }, ctx);
    const everything = await runForTest(discover, { domain: null, detail: "full" }, ctx);

    expect(asked.domains[0]!.entries).toEqual([]);
    expect(everything.domains.map((d) => d.domain)).toEqual(["seats"]);
    // The source exists — it is simply not in this scope's registry.
    expect(await outOfScope.entries(ctx)).toHaveLength(1);
  });

  // BR-4. Never a throw that ends the turn: the next call has to be able to
  // succeed, so the reply carries the names that would work.
  it("names the known domains when asked for one that does not exist", async () => {
    const { discover } = discoveryTools(createManifestRegistry([sourceOf("seats", [seat("reviewer")])]));

    const result = await runForTest(discover, { domain: "agents", detail: "thin" }, ctx);

    expect(result.domains).toEqual([]);
    expect(result.problem).toContain('Unknown domain "agents"');
    expect(result.problem).toContain("seats, channels, skills, resources");
  });

  // BR-5. One misconfigured collection must not cost the agent its whole turn.
  it("reports a throwing reader on its own domain and still answers the others", async () => {
    const { discover } = discoveryTools(
      createManifestRegistry([
        sourceOf("seats", [seat("reviewer")]),
        sourceOf("resources", () => {
          throw new Error("collection store unreachable");
        }),
      ]),
    );

    const result = await runForTest(discover, { domain: null, detail: "thin" }, ctx);

    const resources = result.domains.find((d) => d.domain === "resources")!;
    const seats = result.domains.find((d) => d.domain === "seats")!;
    expect(resources.problem).toBe("collection store unreachable");
    expect(resources.entries).toEqual([]);
    expect(seats.entries).toHaveLength(1);
    expect(seats.problem).toBeUndefined();
  });

  it("withholds the contract hint on a thin read and includes it on a full one", async () => {
    const { discover } = discoveryTools(createManifestRegistry([sourceOf("seats", [seat("reviewer")])]));

    const thin = await runForTest(discover, { domain: "seats", detail: "thin" }, ctx);
    const full = await runForTest(discover, { domain: "seats", detail: "full" }, ctx);

    expect(thin.domains[0]!.entries[0]).toEqual({
      id: "reviewer",
      kind: "seat",
      purpose: "Reviews reviewer work.",
    });
    expect(full.domains[0]!.entries[0]!.contract).toBe("Hand it a task naming reviewer.");
  });

  it("answers an empty registry with nothing to plan against, not a failure", async () => {
    const { discover } = discoveryTools(createManifestRegistry([]));

    const result = await runForTest(discover, { domain: null, detail: "thin" }, ctx);

    expect(result).toEqual({ domains: [] });
  });
});
