import { describe, expect, it } from "vitest";
import type { OutputItem, ResourceChangeItem } from "../src/items/types";
import {
  whenAnyItem,
  whenResourceChanged,
  whenResourceMatching
} from "../src/items/predicates";

/**
 * Synthesise a resource_change item. Test-only — fills the OutputItemBase
 * fields with predictable defaults so each test stays focused on what it
 * actually asserts (scope, path, changeType).
 */
function resourceChange(
  overrides: Partial<ResourceChangeItem> & Pick<ResourceChangeItem, "scope" | "resourcePath" | "changeType">
): ResourceChangeItem {
  return {
    id: overrides.id ?? `rc_${Math.random().toString(36).slice(2)}`,
    type: "resource_change",
    ts: overrides.ts ?? Date.now(),
    itemIndex: overrides.itemIndex ?? 0,
    status: overrides.status ?? "done",
    ...overrides
  } as ResourceChangeItem;
}

/** Stand-in for a non-matching item (any non-resource_change type works). */
function messageItem(text: string): OutputItem {
  return {
    id: `m_${text}`,
    type: "message",
    ts: 0,
    itemIndex: 0,
    status: "done",
    role: "assistant",
    content: [{ type: "output_text", text }]
  } as unknown as OutputItem;
}

describe("whenResourceChanged", () => {
  it("returns true exactly when a matching scope+path item exists", () => {
    const predicate = whenResourceChanged({ scope: "request", path: "artifacts/doc" });
    expect(predicate([])).toBe(false);
    expect(predicate([messageItem("hi")])).toBe(false);
    expect(predicate([
      resourceChange({ scope: "session", resourcePath: "artifacts/doc", changeType: "created" })
    ])).toBe(false);
    expect(predicate([
      resourceChange({ scope: "request", resourcePath: "artifacts/other", changeType: "created" })
    ])).toBe(false);
    expect(predicate([
      resourceChange({ scope: "request", resourcePath: "artifacts/doc", changeType: "created" })
    ])).toBe(true);
  });

  it("narrows on changeType when provided", () => {
    const predicate = whenResourceChanged({
      scope: "request",
      path: "artifacts/doc",
      changeType: "updated"
    });
    expect(predicate([
      resourceChange({ scope: "request", resourcePath: "artifacts/doc", changeType: "created" })
    ])).toBe(false);
    expect(predicate([
      resourceChange({ scope: "request", resourcePath: "artifacts/doc", changeType: "updated" })
    ])).toBe(true);
  });
});

describe("whenAnyItem", () => {
  it("returns true exactly when at least one item matches", () => {
    const isMessage = whenAnyItem((item) => item.type === "message");
    expect(isMessage([])).toBe(false);
    expect(isMessage([
      resourceChange({ scope: "request", resourcePath: "x", changeType: "created" })
    ])).toBe(false);
    expect(isMessage([messageItem("hi")])).toBe(true);
    expect(isMessage([
      resourceChange({ scope: "request", resourcePath: "x", changeType: "created" }),
      messageItem("hi")
    ])).toBe(true);
  });
});

describe("whenResourceMatching", () => {
  it("matches `*` against a single path segment", () => {
    const predicate = whenResourceMatching({ scope: "request", pattern: "artifacts/*" });
    expect(predicate([
      resourceChange({ scope: "request", resourcePath: "artifacts/doc", changeType: "created" })
    ])).toBe(true);
    // `*` doesn't cross path separators
    expect(predicate([
      resourceChange({ scope: "request", resourcePath: "artifacts/sub/doc", changeType: "created" })
    ])).toBe(false);
  });

  it("matches `**` across path segments", () => {
    const predicate = whenResourceMatching({ scope: "request", pattern: "workers/**" });
    expect(predicate([
      resourceChange({ scope: "request", resourcePath: "workers/a/b/done", changeType: "updated" })
    ])).toBe(true);
    expect(predicate([
      resourceChange({ scope: "request", resourcePath: "other/x", changeType: "updated" })
    ])).toBe(false);
  });

  it("respects scope", () => {
    const predicate = whenResourceMatching({ scope: "session", pattern: "*" });
    expect(predicate([
      resourceChange({ scope: "request", resourcePath: "x", changeType: "created" })
    ])).toBe(false);
    expect(predicate([
      resourceChange({ scope: "session", resourcePath: "x", changeType: "created" })
    ])).toBe(true);
  });
});
