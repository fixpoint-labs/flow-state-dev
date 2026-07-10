import { describe, expect, it } from "vitest";
import { parseInput, type ParsedInput } from "../src/chat/parse";

describe("parseInput", () => {
  const cases: Array<{ line: string; expected: ParsedInput; why: string }> = [
    { line: "", expected: { kind: "empty" }, why: "empty string re-prompts" },
    { line: "   ", expected: { kind: "empty" }, why: "whitespace-only re-prompts" },
    {
      line: "hello there",
      expected: { kind: "chat", text: "hello there" },
      why: "plain text is a chat turn",
    },
    {
      line: "/help",
      expected: { kind: "command", name: "help", args: "", raw: "/help" },
      why: "a bare command has no args",
    },
    {
      line: "/use hello-chat chat",
      expected: { kind: "command", name: "use", args: "hello-chat chat", raw: "/use hello-chat chat" },
      why: "the argument tail is captured and trimmed",
    },
    {
      line: "/help   ",
      expected: { kind: "command", name: "help", args: "", raw: "/help   " },
      why: "trailing whitespace after a bare command is not args",
    },
    {
      line: "/",
      expected: { kind: "command", name: "", args: "", raw: "/" },
      why: "a lone slash is a command with an empty name (dispatch → help hint)",
    },
    {
      line: "/UPPER",
      expected: { kind: "command", name: "", args: "", raw: "/UPPER" },
      why: "a slash the grammar rejects is an empty-name command, not chat",
    },
    {
      line: " /etc/hosts is weird",
      expected: { kind: "chat", text: " /etc/hosts is weird" },
      why: "a leading space escapes command parsing, and is preserved so the flow's slash matcher won't fire either",
    },
  ];

  for (const { line, expected, why } of cases) {
    it(`classifies ${JSON.stringify(line)} — ${why}`, () => {
      expect(parseInput(line)).toEqual(expected);
    });
  }
});
