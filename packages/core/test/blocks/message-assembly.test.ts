import { describe, expect, it } from "vitest";
import {
  assembleMessages,
  buildSystemPrefix,
  asUserMessage,
  isEquivalentUserMessage,
  isUserRoleMessage,
  userMessageContentKey,
  stableStringify,
} from "../../src/blocks/internal/message-assembly";
import { createMockContext } from "../helpers";

describe("message-assembly", () => {
  const ctx = createMockContext();

  describe("buildSystemPrefix", () => {
    it("produces a system message from an inline prompt string", async () => {
      const result = await buildSystemPrefix(
        "You are helpful.",
        undefined,
        [],
        "ignored",
        ctx,
        {},
      );
      expect(result.messages).toEqual([
        { role: "system", content: "You are helpful." },
      ]);
      expect(result.promptText).toBe("You are helpful.");
      expect(result.configView).toBeUndefined();
    });

    it("returns empty messages when prompt and context are both empty", async () => {
      const result = await buildSystemPrefix("", undefined, [], "x", ctx, {});
      expect(result.messages).toEqual([]);
      expect(result.promptText).toBe("");
    });

    it("resolves a function prompt", async () => {
      const result = await buildSystemPrefix(
        (_input: unknown, _ctx: unknown) => "dynamic prompt",
        undefined,
        [],
        "x",
        ctx,
        {},
      );
      expect(result.messages).toEqual([
        { role: "system", content: "dynamic prompt" },
      ]);
    });

    it("aggregates tagged context into the system message", async () => {
      const result = await buildSystemPrefix(
        "base prompt",
        undefined,
        [{ tag: "rules", value: "be concise" }],
        "x",
        ctx,
        {},
      );
      expect(result.messages).toHaveLength(1);
      const content = (result.messages[0] as { content: string }).content;
      expect(content).toContain("base prompt");
      expect(content).toContain("rules");
      expect(content).toContain("be concise");
    });

    it("passes through string context entries as separate system messages", async () => {
      const result = await buildSystemPrefix(
        "prompt",
        undefined,
        [{ role: "system", content: "extra" }],
        "x",
        ctx,
        {},
      );
      expect(result.messages.length).toBeGreaterThanOrEqual(2);
      expect(result.messages[1]).toEqual({ role: "system", content: "extra" });
    });

    it("handles null/undefined prompt as empty string", async () => {
      const result = await buildSystemPrefix(
        null as unknown as string,
        undefined,
        [],
        "x",
        ctx,
        {},
      );
      expect(result.messages).toEqual([]);
      expect(result.promptText).toBe("");
    });

    it("joins array prompts with newlines", async () => {
      const result = await buildSystemPrefix(
        ["line one", "line two"],
        undefined,
        [],
        "x",
        ctx,
        {},
      );
      expect(result.promptText).toBe("line one\nline two");
    });
  });

  describe("assembleMessages", () => {
    it("produces system + history + user with correct systemPrefixCount", async () => {
      const result = await assembleMessages(
        {
          promptValue: "system prompt",
          promptFileBrand: undefined,
          contextValues: [],
          historyValues: [{ role: "user", content: "earlier" }],
          resolveUserValues: async () => ["current input"],
          configMeta: {},
          input: "x",
        },
        ctx,
      );

      expect(result.systemPrefixCount).toBe(1);
      expect(result.messages[0]).toEqual({
        role: "system",
        content: "system prompt",
      });
      expect(result.messages[1]).toEqual({
        role: "user",
        content: "earlier",
      });
      expect(result.messages[2]).toEqual({
        role: "user",
        content: "current input",
      });
    });

    it("deduplicates when history tail matches leading user value", async () => {
      const result = await assembleMessages(
        {
          promptValue: "p",
          promptFileBrand: undefined,
          contextValues: [],
          historyValues: [{ role: "user", content: "same" }],
          resolveUserValues: async () => ["same"],
          configMeta: {},
          input: "x",
        },
        ctx,
      );

      const userMsgs = result.messages.filter(
        (m: any) => m?.role === "user",
      );
      expect(userMsgs).toHaveLength(1);
    });

    it("keeps both when user value differs from history tail", async () => {
      const result = await assembleMessages(
        {
          promptValue: "p",
          promptFileBrand: undefined,
          contextValues: [],
          historyValues: [{ role: "user", content: "old" }],
          resolveUserValues: async () => ["new"],
          configMeta: {},
          input: "x",
        },
        ctx,
      );

      const userMsgs = result.messages.filter(
        (m: any) => m?.role === "user",
      );
      expect(userMsgs).toHaveLength(2);
    });

    it("returns userValues from the resolveUserValues callback", async () => {
      const result = await assembleMessages(
        {
          promptValue: "p",
          promptFileBrand: undefined,
          contextValues: [],
          historyValues: [],
          resolveUserValues: async () => ["val1", "val2"],
          configMeta: {},
          input: "x",
        },
        ctx,
      );

      expect(result.userValues).toEqual(["val1", "val2"]);
    });

    it("handles empty history and empty user values", async () => {
      const result = await assembleMessages(
        {
          promptValue: "p",
          promptFileBrand: undefined,
          contextValues: [],
          historyValues: [],
          resolveUserValues: async () => [],
          configMeta: {},
          input: "x",
        },
        ctx,
      );

      expect(result.systemPrefixCount).toBe(1);
      expect(result.messages).toHaveLength(1);
    });
  });

  describe("asUserMessage", () => {
    it("wraps a string in a user-role message", () => {
      expect(asUserMessage("hello")).toEqual({ role: "user", content: "hello" });
    });

    it("passes through non-string values unchanged", () => {
      const obj = { role: "user", content: [{ type: "text", text: "hi" }] };
      expect(asUserMessage(obj)).toBe(obj);
    });
  });

  describe("isEquivalentUserMessage", () => {
    it("matches identical string user messages", () => {
      const a = { role: "user", content: "hi" };
      const b = { role: "user", content: "hi" };
      expect(isEquivalentUserMessage(a, b)).toBe(true);
    });

    it("rejects different content", () => {
      const a = { role: "user", content: "hi" };
      const b = { role: "user", content: "bye" };
      expect(isEquivalentUserMessage(a, b)).toBe(false);
    });

    it("returns false when one side is not a user message", () => {
      expect(
        isEquivalentUserMessage({ role: "system", content: "hi" }, { role: "user", content: "hi" }),
      ).toBe(false);
    });

    it("matches multipart content regardless of key order", () => {
      const a = { role: "user", content: [{ type: "text", text: "hello" }] };
      const b = { role: "user", content: [{ text: "hello", type: "text" }] };
      expect(isEquivalentUserMessage(a, b)).toBe(true);
    });
  });

  describe("isUserRoleMessage", () => {
    it("recognizes a user-role message", () => {
      expect(isUserRoleMessage({ role: "user", content: "x" })).toBe(true);
    });

    it("rejects non-user roles", () => {
      expect(isUserRoleMessage({ role: "system", content: "x" })).toBe(false);
    });

    it("rejects non-objects", () => {
      expect(isUserRoleMessage("string")).toBe(false);
      expect(isUserRoleMessage(null)).toBe(false);
    });
  });

  describe("userMessageContentKey", () => {
    it("returns string content directly", () => {
      expect(userMessageContentKey({ content: "hello" })).toBe("hello");
    });

    it("returns stable JSON for object content", () => {
      const key1 = userMessageContentKey({ content: { b: 2, a: 1 } });
      const key2 = userMessageContentKey({ content: { a: 1, b: 2 } });
      expect(key1).toBe(key2);
    });
  });

  describe("stableStringify", () => {
    it("sorts object keys", () => {
      const result = stableStringify({ z: 1, a: 2 });
      expect(result).toBe('{"a":2,"z":1}');
    });

    it("handles nested objects", () => {
      const result = stableStringify({ b: { d: 1, c: 2 }, a: 0 });
      expect(result).toBe('{"a":0,"b":{"c":2,"d":1}}');
    });

    it("preserves arrays", () => {
      const result = stableStringify([3, 1, 2]);
      expect(result).toBe("[3,1,2]");
    });
  });
});
