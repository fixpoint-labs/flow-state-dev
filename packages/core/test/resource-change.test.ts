import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "../src";
import {
  normalizeReactiveBinding,
  resourceChangeSchema,
  resourceContentChangeSchema,
} from "../src/types/resource-change";

const noopBlock = handler({
  name: "noop",
  execute: () => {},
});

describe("resourceChangeSchema", () => {
  it("parses a well-formed created change and rejects a malformed one", () => {
    const schema = resourceChangeSchema(z.object({ status: z.string() }));

    const created = {
      key: "memo-1",
      ref: "artifacts/memo-1",
      kind: "created" as const,
      state: { status: "draft" },
      prevState: null,
      evicted: false,
    };
    expect(schema.parse(created)).toEqual(created);

    // Missing `evicted`.
    expect(
      schema.safeParse({
        key: "memo-1",
        ref: "artifacts/memo-1",
        kind: "created",
        state: { status: "draft" },
        prevState: null,
      }).success
    ).toBe(false);

    // Wrong `kind`.
    expect(
      schema.safeParse({
        key: "memo-1",
        ref: "artifacts/memo-1",
        kind: "moved",
        state: { status: "draft" },
        prevState: null,
        evicted: false,
      }).success
    ).toBe(false);
  });

  it("accepts state: null for a deleted change", () => {
    const schema = resourceChangeSchema(z.object({ status: z.string() }));

    const deleted = {
      key: "memo-1",
      ref: "artifacts/memo-1",
      kind: "deleted" as const,
      state: null,
      prevState: { status: "draft" },
      evicted: false,
    };
    expect(schema.parse(deleted)).toEqual(deleted);
  });

  it("parses a stateUpdated change (the renamed in-place state kind)", () => {
    const schema = resourceChangeSchema(z.object({ status: z.string() }));

    const updated = {
      key: "memo-1",
      ref: "artifacts/memo-1",
      kind: "stateUpdated" as const,
      state: { status: "published" },
      prevState: { status: "draft" },
      evicted: false,
    };
    expect(schema.parse(updated)).toEqual(updated);

    // The old `updated` literal is no longer a valid kind.
    expect(
      schema.safeParse({
        key: "memo-1",
        ref: "artifacts/memo-1",
        kind: "updated",
        state: { status: "published" },
        prevState: { status: "draft" },
        evicted: false,
      }).success
    ).toBe(false);
  });
});

describe("resourceContentChangeSchema", () => {
  it("parses a well-formed content change and rejects malformed ones", () => {
    const schema = resourceContentChangeSchema();

    const change = {
      key: "memo-1",
      ref: "artifacts/memo-1",
      kind: "contentUpdated" as const,
    };
    expect(schema.parse(change)).toEqual(change);

    // Wrong `kind` — a state-change payload must not satisfy the content schema.
    expect(
      schema.safeParse({ key: "memo-1", ref: "artifacts/memo-1", kind: "stateUpdated" }).success
    ).toBe(false);

    // Missing `ref`.
    expect(schema.safeParse({ key: "memo-1", kind: "contentUpdated" }).success).toBe(false);
  });
});

describe("normalizeReactiveBinding", () => {
  it("wraps a bare block and passes through { block, when }", () => {
    expect(normalizeReactiveBinding(noopBlock)).toEqual({ block: noopBlock });

    const when = () => true;
    expect(normalizeReactiveBinding({ block: noopBlock, when })).toEqual({
      block: noopBlock,
      when,
    });
  });
});
