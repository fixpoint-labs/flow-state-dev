/**
 * The rendering contract, held to a real shell.
 *
 * Every case here asserts the same property — `sh` splits the rendered line back
 * into the argv it was given — because that is the only statement worth making
 * about quoting. Asserting the *output string* instead would pass on any
 * self-consistent scheme, including a broken one, which is how a quoting helper
 * ends up covering the easy case and nothing else.
 */

import { describe, expect, it } from "vitest";

import { renderCommand } from "../../src/util/command";
import { shellWords } from "../shell";

describe("renderCommand", () => {
  it.each([
    ["an ordinary command", ["pnpm", "goal", "FIX-1"]],
    ["an element holding spaces", ["bash", "-lc", "pnpm tsx goals/run-for-issue.mts"]],
    ["an element holding single quotes", ["node", "-e", "console.log('hi')"]],
    ["an element holding double quotes", ["grep", '"quoted"', "file.ts"]],
    ["shell metacharacters", ["sh", "-c", "a && b | c > d; e & f"]],
    ["expansions that must stay literal", ["echo", "$HOME `whoami` ${x} *"]],
    ["a newline inside one element", ["printf", "first\nsecond"]],
    ["an empty element", ["cmd", "", "after"]],
    ["a lone quote", ["cmd", "'"]],
    ["backslashes", ["cmd", "C:\\path\\to", "a\\'b"]],
  ] as const)("survives a shell round-trip with %s", async (_case, argv) => {
    await expect(shellWords(renderCommand([...argv]))).resolves.toEqual([...argv]);
  });

  /**
   * Quoting what needs no quoting would make every ordinary command harder to
   * read for no gain, and this is a rendering a person reads first.
   */
  it("leaves a command that needs no quoting exactly as it was", () => {
    expect(renderCommand(["pnpm", "tsx", "goals/run-for-issue.mts", "--all"])).toBe(
      "pnpm tsx goals/run-for-issue.mts --all",
    );
  });

  it("renders an empty argv as an empty line rather than throwing", () => {
    expect(renderCommand([])).toBe("");
  });
});
