/**
 * Specs for the install half: document records become the L1 resource map an
 * app already passes to a flow.
 *
 * The refusal specs here are the second door. A `ResourceDoc[]` can be built by
 * hand and never pass the reader, so the field the convention derives has to be
 * refused where the resource is built too — the same two-door reason `hire.ts`
 * already has.
 */
import { defineFlow } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { resourcesFromDocs } from "../src/resources-from-docs";
import { passthroughFrom } from "../src/resources-from-docs";
import type { ResourceDoc } from "../src/manifest";

/** One document record, as the reader would have handed it back. */
function doc(ref: string, declared: Record<string, unknown> = {}, body = "the body"): ResourceDoc {
  return { ref, declared: { description: "A document.", ...declared }, body };
}

describe("resourcesFromDocs", () => {
  // R3 — the map, keyed by the atlas's ref form.
  it("keys the map by the document's ref and carries the body as content at org scope", () => {
    const resources = resourcesFromDocs([
      doc("code-of-conduct", {}, "Be kind."),
      doc("teams/engineering/handbook", {}, "Escalate within 15 minutes."),
    ]);

    expect(Object.keys(resources).sort()).toEqual([
      "code-of-conduct",
      "teams/engineering/handbook",
    ]);

    const handbook = resources["teams/engineering/handbook"]!;
    expect(handbook.scope).toBe("org");
    expect(handbook.ref).toBe("teams/engineering/handbook");
    expect((handbook as { content?: string }).content).toBe("Escalate within 15 minutes.");
  });

  it("gives a document a state shape it can be stored under, with an empty default", () => {
    const resources = resourcesFromDocs([doc("code-of-conduct")]);
    const entry = resources["code-of-conduct"]!;

    expect(entry.default).toEqual({});
    expect(entry.stateSchema.safeParse({}).success).toBe(true);
  });

  it("carries every key outside the derived set through to the resource", () => {
    const resources = resourcesFromDocs([
      doc("code-of-conduct", {
        llmReadable: true,
        writable: true,
        allowedExtensions: ["md"],
        metadata: { owner: "platform" },
      }),
    ]);
    const entry = resources["code-of-conduct"]! as Record<string, unknown>;

    expect(entry["llmReadable"]).toBe(true);
    expect(entry["writable"]).toBe(true);
    expect(entry["allowedExtensions"]).toEqual(["md"]);
    expect(entry["metadata"]).toEqual({ owner: "platform" });
    expect(entry["description"]).toBe("A document.");
  });

  it("produces a map a flow accepts, slashed accessor keys and all", () => {
    const resources = resourcesFromDocs([doc("teams/engineering/handbook")]);

    const flow = defineFlow({
      kind: "support",
      actions: {},
      resources,
    });

    expect(Object.keys(flow.resources ?? {})).toEqual(["teams/engineering/handbook"]);
  });

  // R4, install door.
  describe("refuses every field the convention derives", () => {
    const derived: Array<[string, unknown]> = [
      ["scope", "user"],
      ["ref", "somewhere-else"],
      ["stateSchema", "not-a-schema"],
      ["default", {}],
      ["content", "hijacked"],
      ["contentFile", "./other.md"],
      ["contentTemplate", "./other.liquid"],
      ["contentTemplateRef", "other"],
    ];

    it.each(derived)("throws on a hand-built doc declaring `%s`, naming the ref", (key, value) => {
      expect(() =>
        resourcesFromDocs([doc("teams/engineering/handbook", { [key as string]: value })]),
      ).toThrow(new RegExp(`teams/engineering/handbook[\\s\\S]*\`${key}:\``));
    });

    it("throws on a hand-built doc asking for a lazy prefetchMode", () => {
      expect(() =>
        resourcesFromDocs([doc("code-of-conduct", { prefetchMode: "lazy" })]),
      ).toThrow(/prefetchMode/);
    });

    /**
     * The second mechanism, tested where it is reachable.
     *
     * The refusal above is the loud guard; this is the one that holds if the
     * refusal is ever missed. F1a-F1c were all the same bug — frontmatter
     * spread over the derived fields — so the bag that reaches
     * `defineResource` must not be able to carry one at all. A raw
     * `{ ...declared }` passthrough fails this spec.
     */
    it("never lets a derived field into the bag handed to defineResource", () => {
      const bag = passthroughFrom({
        description: "A document.",
        llmReadable: true,
        ref: "somewhere-else",
        content: "hijacked",
        stateSchema: "not-a-schema",
        default: { smuggled: true },
        scope: "user",
        contentFile: "./other.md",
        contentTemplate: "./other.liquid",
        contentTemplateRef: "other",
      });

      expect(bag).toEqual({ description: "A document.", llmReadable: true });
    });
  });

  it("throws naming the ref when the frontmatter makes defineResource reject the resource", () => {
    // Two mutually exclusive client projections — startup misconfiguration, not
    // a per-document problem the reader collects.
    expect(() =>
      resourcesFromDocs([
        doc("code-of-conduct", { client: { expose: ["a"], exclude: ["b"] } }),
      ]),
    ).toThrow(/code-of-conduct/);
  });
});
