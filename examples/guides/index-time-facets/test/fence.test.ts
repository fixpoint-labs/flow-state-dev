/**
 * The fence around the example. It may use only published FSD packages and
 * must never build its own classifier: no lab, no kitchen-sink, no intent
 * classifier, no generator. And its collection grants no client content
 * edits, which would change a body without classifying it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ticketsFlow } from "../src/flow";
import { scriptedModel, triageOn } from "./helpers";

const ROOT = join(__dirname, "..");
const ALLOWED = new Set(["@flow-state-dev/core", "@flow-state-dev/engine", "zod"]);

/** Why a source file breaks the fence; empty when it doesn't. */
function fenceViolations(source: string): string[] {
  const problems: string[] = [];
  for (const [, spec] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (!spec.startsWith(".") && !ALLOWED.has(spec)) problems.push(`imports ${spec}`);
  }
  if (/intentClassifier/.test(source)) problems.push("uses intentClassifier");
  if (/\bgenerator\s*\(/.test(source)) problems.push("builds a generator");
  return problems;
}

function recipeSources(): Array<[string, string]> {
  const files = readdirSync(join(ROOT, "src")).map((f) => join("src", f));
  return [...files, "fsdev.config.ts"].map((f) => [f, readFileSync(join(ROOT, f), "utf8")]);
}

describe("V8: the example's fence", () => {
  it("imports only published FSD packages and builds no classifier of its own", () => {
    const violations = recipeSources().flatMap(([file, src]) => fenceViolations(src).map((v) => `${file}: ${v}`));
    expect(violations).toEqual([]);
  });

  it("negative control: a planted lab import or generator is caught", () => {
    expect(fenceViolations(`import { x } from "@flow-state-dev/lab-typesafe-jev";`)).toEqual([
      "imports @flow-state-dev/lab-typesafe-jev",
    ]);
    expect(fenceViolations(`const g = generator({ name: "g" });`)).toEqual(["builds a generator"]);
    expect(fenceViolations(`utility.intentClassifier({})`)).toEqual(["uses intentClassifier"]);
  });

  it("the ticket collection grants clients no content edits", () => {
    const flow = ticketsFlow(triageOn(scriptedModel(() => ({}))));
    const tickets = (flow as unknown as { resources?: Record<string, { client?: unknown }> }).resources?.tickets;
    expect(tickets).toBeDefined();
    expect(tickets!.client).toBeUndefined();
  });
});
