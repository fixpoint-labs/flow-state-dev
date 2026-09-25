// The guide teaches from this example, so its code must not drift from it.
// Every titled code block on the page must name a file here, and its lines
// must appear in that file, in order (a trimmed excerpt, never new code).
// The refusal the page prints must be the one the classifier really throws.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openai } from "@ai-sdk/openai";
import { describe, expect, it } from "vitest";
import { classifyTicket } from "../src/classify";

const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guidePath = path.resolve(exampleDir, "../../../apps/docs/guides/routing-with-evaluators.md");
const guide = readFileSync(guidePath, "utf8");

type Fence = { lang: string; title?: string; body: string[] };

function fences(markdown: string): Fence[] {
  const out: Fence[] = [];
  const re = /^```(\w+)([^\n]*)\n([\s\S]*?)^```$/gm;
  for (const m of markdown.matchAll(re)) {
    const title = /title="([^"]+)"/.exec(m[2]!)?.[1];
    out.push({ lang: m[1]!, ...(title ? { title } : {}), body: m[3]!.split("\n") });
  }
  return out;
}

/** Index of the first line of `excerpt` missing from `file` in order, or -1. */
function firstMissing(excerpt: string[], file: string[]): number {
  const wanted = excerpt.map((l) => l.trim()).filter((l) => l.length > 0);
  let at = 0;
  for (let i = 0; i < wanted.length; i++) {
    while (at < file.length && file[at]!.trim() !== wanted[i]) at++;
    if (at === file.length) return i;
    at++;
  }
  return -1;
}

describe("the Routing with evaluators guide", () => {
  const all = fences(guide);
  const source = all.filter((f) => f.lang !== "bash" && f.lang !== "text");

  it("titles every source block with a file in this example, and each is cut from it", () => {
    expect(source.length).toBeGreaterThanOrEqual(4);
    for (const fence of source) {
      expect(fence.title, `a ${fence.lang} block has no title`).toBeDefined();
      const file = path.join(exampleDir, fence.title!);
      expect(existsSync(file), `${fence.title} is not in the example`).toBe(true);
      const lines = readFileSync(file, "utf8").split("\n");
      const missing = firstMissing(fence.body, lines);
      const wanted = fence.body.map((l) => l.trim()).filter(Boolean);
      expect(missing === -1 ? "" : wanted[missing], `${fence.title}: this line isn't in the file, in order`).toBe("");
    }
  });

  it("prints the refusal the classifier throws for a text model", () => {
    const shown = all.find((f) => f.lang === "text")!.body.join("\n").trim();
    let thrown = "";
    try {
      classifyTicket(openai("gpt-5.4-mini") as never);
    } catch (err) {
      thrown = (err as Error).message;
    }
    expect(shown).toBe(thrown);
  });

  it("runs every command from this example's flow and actions", () => {
    const commands = all.filter((f) => f.lang === "bash").flatMap((f) => f.body).filter((l) => l.startsWith("pnpm fsdev"));
    expect(commands.length).toBeGreaterThanOrEqual(4);
    for (const command of commands) {
      expect(command).toMatch(/^pnpm fsdev run routing-with-evaluators (classify|route|routeWithoutConfidence|activate) -i '\{"message":"[^'"]+"\}'$/);
    }
  });

  it("names no internal tracking ids and none of the retired designs", () => {
    expect(guide).not.toMatch(/\b(FIX|PR)[- #]?\d+/);
    expect(guide).not.toMatch(/System One|OpenRouter|Decisions client|kitchen-sink|thinking-style|generator fallback/i);
  });
});
