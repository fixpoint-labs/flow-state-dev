/**
 * Specs for the install half: document records become the L1 resource map an
 * app already passes to a flow.
 *
 * The refusal specs here are the second door. A `ResourceDoc[]` can be built by
 * hand and never pass the reader, so the field the convention derives has to be
 * refused where the resource is built too — the same two-door reason `hire.ts`
 * already has.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { testFlow } from "@flow-state-dev/testing";
import { describe, expect, it } from "vitest";
import { resourcesFromDocs } from "../src/resources-from-docs";
import { passthroughFrom } from "../src/resources-from-docs";
import { DERIVED_RESOURCE_KEYS, type ResourceDoc } from "../src/manifest";
import { DERIVED_KEY_CASES } from "./derived-key-cases";

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
    /**
     * The table is shared with the reader door's spec, because what is under
     * test is that BOTH doors refuse the SAME set. This spec holds it to the
     * convention's own list, so a derived key added later fails here until the
     * two doors are graded on it.
     */
    it("grades every key the convention derives, and no others", () => {
      expect(DERIVED_KEY_CASES.map((c) => c.key).sort()).toEqual(
        [...DERIVED_RESOURCE_KEYS].sort(),
      );
    });

    it.each(DERIVED_KEY_CASES)(
      "throws on a hand-built doc declaring `$key`, naming the ref",
      ({ key, value }) => {
        expect(() =>
          resourcesFromDocs([doc("teams/engineering/handbook", { [key]: value })]),
        ).toThrow(new RegExp(`teams/engineering/handbook[\\s\\S]*\`${key}:\``));
      },
    );

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

  /**
   * The hand-built door's own hazard. `__proto__` is not a key the reader can
   * mint — the segment rules admit only lowercase letters, digits and single
   * hyphens — but a `ResourceDoc[]` built by hand never passes the reader, and
   * that second door is the one this module exists to hold.
   *
   * Written on an ordinary object, `map["__proto__"] = definition` reaches the
   * legacy prototype setter: the entry never becomes an own property, so
   * `Object.keys` misses it and the spread the README tells an app to write
   * drops the document without a word. The engine's own resource registries
   * take null prototypes for exactly this reason.
   */
  describe("keys that collide with an inherited member", () => {
    it("keeps a document whose ref is `__proto__` as an own key that survives the spread", () => {
      const resources = resourcesFromDocs([doc("__proto__", {}, "Be kind.")]);

      expect(Object.keys(resources)).toEqual(["__proto__"]);

      // The install step the README documents: spread into the app's own map.
      const spread = { ...resources };
      expect(Object.keys(spread)).toEqual(["__proto__"]);
      expect((spread["__proto__"] as { content?: string }).content).toBe("Be kind.");
    });

    it("carries a frontmatter key named `__proto__` through to the bag verbatim", () => {
      // The shape `parseFrontmatterYaml` really returns: a null-prototype
      // record, on which `__proto__:` in a file IS an own key. A plain `{}`
      // passthrough loses it silently, against the module's promise that
      // everything outside the derived set is carried as written.
      const declared: Record<string, unknown> = Object.create(null);
      declared["description"] = "A document.";
      declared["__proto__"] = { owner: "platform" };

      const bag = passthroughFrom(declared);

      expect(Object.keys(bag).sort()).toEqual(["__proto__", "description"]);
      expect(Object.getOwnPropertyDescriptor(bag, "__proto__")?.value).toEqual({
        owner: "platform",
      });
    });
  });

  /**
   * Every file-declared document is org-scoped, and a flow does not derive its
   * org requirement from a flow-level resource — `requiresOrg` is collected off
   * the blocks. So a flow that installs documents and never declares
   * `requireOrg` accepts a user-only request and then has no documents on it:
   * the org registry is never built, and every ref resolves as unregistered.
   *
   * The convention cannot close that from here (it is pure, and runs long
   * before a principal exists), so it is documented instead — in the README, on
   * the docs page, and on `resourcesFromDocs` itself. These specs are what make
   * that instruction falsifiable: they run the real execution path and show
   * both halves.
   */
  describe("a file-declared document needs an org identity to reach a block", () => {
    const documents = [doc("teams/engineering/handbook", {}, "QUARRY-3157")];

    /** A flow whose block reads the handbook, with and without the documented flag. */
    function buildFlow(declareRequireOrg: boolean) {
      const seen: string[] = [];
      const read = handler({
        name: "read-handbook",
        ...(declareRequireOrg ? { requireOrg: true } : {}),
        execute: async (_input: unknown, ctx) => {
          try {
            seen.push(
              String(await ctx.resources.get("teams/engineering/handbook").readContent()),
            );
          } catch (err) {
            seen.push(`refused: ${(err as Error).message}`);
          }
          return {};
        },
      });

      return {
        seen,
        flow: defineFlow({
          kind: `support-${declareRequireOrg ? "org" : "bare"}`,
          actions: { answer: { block: read } },
          resources: { ...resourcesFromDocs(documents) },
        }),
      };
    }

    it("is not registered on a request that carries no org", async () => {
      const { flow, seen } = buildFlow(false);

      await testFlow({ flow, action: "answer", input: {}, userId: "u1" });

      expect(seen).toEqual([
        'refused: Resource "teams/engineering/handbook" is not registered',
      ]);
    });

    it("arrives with its own body once the request carries one", async () => {
      const { flow, seen } = buildFlow(false);

      await testFlow({ flow, action: "answer", input: {}, userId: "u1", seed: { org: {} } });

      expect(seen).toEqual(["QUARRY-3157"]);
    });

    it("only demands an org when a block says so — installing documents does not", () => {
      // The documented fix, and the reason it is needed: the flow-level
      // resource map contributes nothing to `requiresOrg`, so the transport
      // door has nothing to refuse an org-less request with until a block
      // declares `requireOrg`.
      expect(buildFlow(false).flow.requiresOrg).toBe(false);
      expect(buildFlow(true).flow.requiresOrg).toBe(true);
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
