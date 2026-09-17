/**
 * Specs for the install half of the code door: a generated `resourceModules`
 * map becomes the capabilities a worker kind installs and the resources a flow
 * declares.
 *
 * The two halves have different destinations and the same folder, so the checks
 * here run to the destination rather than stopping at the return value: a
 * capability's own resources are asserted on a real `defineFlow`, and a
 * module's plain resource is asserted in the same map a Markdown document
 * lands in. A split that sorts the two correctly and reaches neither would pass
 * an assertion on its own output.
 *
 * The refusals are the second door, for the reason `resources-from-docs.test`
 * has one: a `ResourceModules` map can be written by hand or left stale, and
 * the typed generated map is only a check on the file that was generated.
 */
import { defineCapability, defineFlow, defineResource, generator } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resourcesFromDocs } from "../src/resources-from-docs";
import { splitResourceModules } from "../src/split-resource-modules";
import type { ResourceModules } from "../src/resource-modules";
import type { ResourceDoc } from "../src/manifest";

/** A resource a capability carries with it, reached through `uses` and never through the map. */
const briefing = defineResource({
  ref: "briefing",
  scope: "org",
  stateSchema: z.object({}).passthrough(),
  default: {},
});

/** A capability, written the way an author writes one in a team's `resources/` folder. */
const research = defineCapability({
  name: "research",
  resources: { briefing },
  presets: { briefing: { context: [] }, default: [] },
});

/** A plain resource module — the other thing a `.ts` file in that folder may be. */
const glossary = defineResource({
  ref: "teams/engineering/glossary",
  scope: "org",
  stateSchema: z.object({}).passthrough(),
  default: {},
});

/** One document record, as the Markdown door would have handed it back. */
function doc(ref: string, body = "the body"): ResourceDoc {
  return { ref, declared: { description: "A document." }, body };
}

describe("splitResourceModules", () => {
  // BR-7 — a capability lands on a kind through the `uses` option an app
  // already writes by hand, and its declared resources reach the flow from
  // there. Asserted on a real flow: `uses` is the whole reason a capability
  // cannot go in the resource map, so stopping at the returned list would not
  // check the claim.
  it("hands a capability to `uses`, and its declared resources reach the flow", () => {
    const { capabilities } = splitResourceModules({
      "teams/engineering/research": research,
    });

    expect(capabilities).toEqual([research]);

    const flow = defineFlow({
      kind: "support",
      actions: {
        ask: {
          block: generator({
            name: "ask",
            uses: capabilities,
            model: "intent/utility",
            prompt: "x",
          }),
        },
      },
    });

    expect(flow.resources?.["briefing"]).toBe(briefing);
  });

  // BR-7, the other half of the same claim: a capability is NOT a resource. It
  // has no `ref` and no `stateSchema`, so a capability filed into the resource
  // map reaches a flow as a broken declaration rather than as a capability.
  it("keeps a capability out of the resource map", () => {
    const { resources } = splitResourceModules({
      "teams/engineering/research": research,
    });

    expect(Object.keys(resources)).toEqual([]);
  });

  // BR-8 — one map. A module's plain resource and a document's resource are
  // spread together at the app's own call site and both reach the flow under
  // their own ref.
  it("merges a module resource into the same map the documents fill", () => {
    const { resources } = splitResourceModules({
      "teams/engineering/glossary": glossary,
    });

    expect(resources["teams/engineering/glossary"]).toBe(glossary);

    const flow = defineFlow({
      kind: "support",
      actions: {},
      resources: { ...resourcesFromDocs([doc("teams/engineering/handbook")]), ...resources },
    });

    expect(Object.keys(flow.resources ?? {}).sort()).toEqual([
      "teams/engineering/glossary",
      "teams/engineering/handbook",
    ]);
  });

  it("splits a folder holding both, in one call", () => {
    const { capabilities, resources } = splitResourceModules({
      "teams/engineering/glossary": glossary,
      "teams/engineering/research": research,
    });

    expect(capabilities).toEqual([research]);
    expect(Object.keys(resources)).toEqual(["teams/engineering/glossary"]);
  });

  // The prototype-chain read, as its own spec. `.presets()` and `.config()`
  // return a clone made with `Object.create(base)`, so a capability an author
  // configured before exporting carries the brand on its prototype. An
  // own-property check sorts this one into the resource map — where it reaches
  // a flow as a declaration with no `ref` — and every assertion above still
  // passes, which is why this case is pinned separately.
  it("recognises a capability an author configured before exporting it", () => {
    const configured = research.presets({ briefing: true });

    const { capabilities, resources } = splitResourceModules({
      "teams/engineering/research": configured,
    });

    expect(capabilities).toEqual([configured]);
    expect(Object.keys(resources)).toEqual([]);
  });

  it("refuses an entry that is neither, naming the ref and what it found", () => {
    expect(() =>
      splitResourceModules({
        "teams/engineering/research": undefined,
      } as unknown as ResourceModules),
    ).toThrow(/"teams\/engineering\/research" exports nothing, not a capability or a resource/);
  });

  it("refuses a bare value, naming the ref", () => {
    expect(() =>
      splitResourceModules({
        "teams/engineering/research": "not a declaration",
      } as unknown as ResourceModules),
    ).toThrow(/"teams\/engineering\/research" exports a string/);
  });

  // The resource map's keys are refs, and a ref is a name somebody else chose.
  // On an ordinary object `map["__proto__"] = entry` reaches the legacy
  // prototype setter, and the entry vanishes from `Object.keys` and from every
  // spread — the silent drop this whole convention exists to remove.
  it("keeps a resource whose ref is `__proto__`", () => {
    // A computed key, because a literal `__proto__:` IS the prototype setter —
    // the very thing this spec is about — and would set no own property here.
    const { resources } = splitResourceModules({
      ["__proto__"]: glossary,
    } as unknown as ResourceModules);

    expect(Object.keys(resources)).toEqual(["__proto__"]);
    expect(resources["__proto__"]).toBe(glossary);
  });

  it("returns empty halves for a tree with no modules", () => {
    const { capabilities, resources } = splitResourceModules({});

    expect(capabilities).toEqual([]);
    expect(Object.keys(resources)).toEqual([]);
  });
});
