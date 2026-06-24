// @vitest-environment happy-dom
/**
 * Tests for the non-binary HITL controller (FIX-849).
 *
 * `analyzeResumeSchema` is exercised as a pure function (field derivation + the
 * flat-schema boundary). `useSuspensionForm` is driven through `renderHook` with
 * a SuspensionResolverProvider so the submit/skip transport, bounded validation,
 * and number coercion are observed end to end without a network.
 */
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ItemProvenance, SuspensionItem } from "@flow-state-dev/core/items";
import {
  analyzeResumeSchema,
  suspensionShape,
  useSuspensionForm,
  FlowProvider,
  SuspensionResolverProvider,
  type SuspensionResolver
} from "../src";

const provenance: ItemProvenance = { blockName: "ask", blockInstanceId: "b1", phase: "main" };

function suspension(overrides: Partial<SuspensionItem> = {}): SuspensionItem {
  return {
    id: "item_sus",
    type: "suspension",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance,
    ts: 0,
    suspensionId: "sus_1",
    reason: "human_input",
    message: "Tell us more",
    ...overrides
  } as SuspensionItem;
}

function wrapperWith(resolve: SuspensionResolver) {
  return ({ children }: { children: ReactNode }) =>
    createElement(
      FlowProvider,
      { flowKind: "demo" },
      createElement(SuspensionResolverProvider, { resolve }, children)
    );
}

describe("analyzeResumeSchema", () => {
  it("derives fields for a flat object of scalars and enums", () => {
    const analysis = analyzeResumeSchema({
      type: "object",
      properties: {
        note: { type: "string" },
        priority: { type: "string", enum: ["low", "high"] },
        urgent: { type: "boolean" }
      },
      required: ["note"]
    });
    expect(analysis?.kind).toBe("object");
    const byKey = Object.fromEntries((analysis?.fields ?? []).map((f) => [f.key, f]));
    expect(byKey.note.kind).toBe("string");
    expect(byKey.note.required).toBe(true);
    expect(byKey.priority.kind).toBe("enum");
    expect(byKey.priority.options).toEqual(["low", "high"]);
    expect(byKey.urgent.kind).toBe("boolean");
    expect(byKey.urgent.required).toBe(false);
  });

  it("classifies a top-level enum and an array-of-enum", () => {
    expect(analyzeResumeSchema({ type: "string", enum: ["a", "b"] })).toMatchObject({
      kind: "enum",
      options: ["a", "b"]
    });
    expect(
      analyzeResumeSchema({ type: "array", items: { type: "string", enum: ["x", "y"] } })
    ).toMatchObject({ kind: "enum-multi", options: ["x", "y"] });
  });

  it("treats a missing schema as free-text and a single string as a string", () => {
    expect(analyzeResumeSchema(undefined)).toMatchObject({ kind: "string" });
    expect(analyzeResumeSchema({ type: "string" })).toMatchObject({ kind: "string" });
  });

  it("returns null for schemas richer than the bounded set (nested object)", () => {
    expect(
      analyzeResumeSchema({
        type: "object",
        properties: { nested: { type: "object", properties: { a: { type: "string" } } } }
      })
    ).toBeNull();
  });
});

describe("suspensionShape", () => {
  it("routes human_input to a card by schema shape when submit is allowed", () => {
    expect(suspensionShape({ reason: "human_input", allow: ["submit"] })).toBe("question");
    expect(
      suspensionShape({ reason: "human_input", allow: ["submit"], resumeSchema: { type: "string", enum: ["a"] } })
    ).toBe("selection");
    expect(
      suspensionShape({
        reason: "human_input",
        allow: ["submit"],
        resumeSchema: { type: "object", properties: { a: { type: "string" } } }
      })
    ).toBe("form");
  });

  it("falls back to the approval card for human_approval and for binary/legacy human_input", () => {
    expect(suspensionShape({ reason: "human_approval", allow: ["approve", "reject"] })).toBe("approval");
    // Legacy human_input with no allow (route treats as binary) → approval.
    expect(suspensionShape({ reason: "human_input" })).toBe("approval");
    // Explicitly binary human_input (no submit path) → approval, not a submit card.
    expect(suspensionShape({ reason: "human_input", allow: ["approve", "reject"] })).toBe("approval");
  });
});

describe("useSuspensionForm", () => {
  it("gates canSubmit on required-field validation and submits the coerced payload", async () => {
    const resolve = vi.fn<SuspensionResolver>().mockResolvedValue(undefined);
    const item = suspension({
      allow: ["submit"],
      resumeSchema: {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name"]
      }
    });

    const { result } = renderHook(() => useSuspensionForm(item), { wrapper: wrapperWith(resolve) });

    // Required `name` is empty → cannot submit, with a path-keyed error.
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.errors.name).toBe("Required");

    act(() => {
      result.current.setField("name", "Ada");
      result.current.setField("age", "42");
    });
    expect(result.current.canSubmit).toBe(true);

    await act(async () => {
      await result.current.submit();
    });

    // Number field coerced to a JSON number for server-side schema validation.
    expect(resolve).toHaveBeenCalledWith({
      suspensionId: "sus_1",
      requestId: "req_1",
      action: "submit",
      data: { name: "Ada", age: 42 }
    });
  });

  it("shows skip only when allow includes it and resolves with action:skip", async () => {
    const resolve = vi.fn<SuspensionResolver>().mockResolvedValue(undefined);
    const skippable = suspension({ allow: ["submit", "skip"] });
    const { result } = renderHook(() => useSuspensionForm(skippable), {
      wrapper: wrapperWith(resolve)
    });
    expect(result.current.canSkip).toBe(true);

    await act(async () => {
      await result.current.skip();
    });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ action: "skip", suspensionId: "sus_1" })
    );

    cleanup();

    const resolve2 = vi.fn<SuspensionResolver>().mockResolvedValue(undefined);
    const notSkippable = suspension({ allow: ["submit"] });
    const { result: r2 } = renderHook(() => useSuspensionForm(notSkippable), {
      wrapper: wrapperWith(resolve2)
    });
    expect(r2.current.canSkip).toBe(false);
  });

  it("omits blank optional fields from the submit payload", async () => {
    const resolve = vi.fn<SuspensionResolver>().mockResolvedValue(undefined);
    const item = suspension({
      allow: ["submit"],
      resumeSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          tier: { type: "string", enum: ["free", "pro"] } // optional enum
        },
        required: ["name"]
      }
    });
    const { result } = renderHook(() => useSuspensionForm(item), { wrapper: wrapperWith(resolve) });

    act(() => result.current.setField("name", "Ada")); // leave optional `tier` blank
    expect(result.current.canSubmit).toBe(true);
    await act(async () => {
      await result.current.submit();
    });

    // The blank optional enum must not be sent as "" (which would fail the enum).
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ action: "submit", data: { name: "Ada" } })
    );
  });

  it("requires a top-level enum selection before submit", () => {
    const resolve = vi.fn<SuspensionResolver>().mockResolvedValue(undefined);
    const item = suspension({
      allow: ["submit"],
      resumeSchema: { type: "string", enum: ["yes", "no"] }
    });
    const { result } = renderHook(() => useSuspensionForm(item), { wrapper: wrapperWith(resolve) });

    expect(result.current.kind).toBe("enum");
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setValue("yes"));
    expect(result.current.canSubmit).toBe(true);
  });

  it("renders read-only once resolved", () => {
    const resolve = vi.fn<SuspensionResolver>().mockResolvedValue(undefined);
    const { result } = renderHook(
      () => useSuspensionForm(suspension({ allow: ["submit"] }), { isResolved: true, resolution: "submitted" }),
      { wrapper: wrapperWith(resolve) }
    );
    expect(result.current.resolved).toBe(true);
    expect(result.current.outcome.label).toBe("Submitted");
    expect(result.current.canSubmit).toBe(false);
  });
});
