/**
 * Every engine read of a flow's scope state schema goes through
 * `scopeStateSchema(flow, scope)`, the flow's merged schema.
 *
 * A read of `flow.session.stateSchema` (or user / org) straight off the flow
 * sees only what the flow declared, so a field a block declares would get no
 * default, or a readonly field a block declares no protection. This scans
 * engine source for such reads. The one allowed: a write that validates
 * against the flow's own schema, named below with its reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../src");

/** A read of a flow's own scope state schema, however the flow is named. */
const DIRECT_READ = /\.(session|user|org)\??\.stateSchema\b/;

/** Reads that must take the flow's own schema, by file, with why. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "context/session-birth.ts": { count: 1, why: "a new session's initial state is a write, validated against the flow's own schema" },
  "routes/session-routes.ts": { count: 1, why: "the list's state filter runs on stored state, which holds only what the flow's own schema births" }
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** The direct reads in `text`, comment lines skipped. */
export function directReads(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line) && DIRECT_READ.test(line))
    .map((line) => line.trim());
}

describe("scope state schema reads go through scopeStateSchema", () => {
  it("no engine source reads a flow's own scope state schema outside the allowed write", () => {
    const found: Record<string, string[]> = {};
    for (const file of sources(SRC)) {
      const reads = directReads(readFileSync(file, "utf8"));
      if (reads.length > 0) found[relative(SRC, file)] = reads;
    }
    const unexpected = Object.entries(found).filter(([file, reads]) => ALLOWED[file]?.count !== reads.length);
    expect(Object.fromEntries(unexpected)).toEqual({});
  });

  it("control: a planted direct read is caught, in any spelling of the flow", () => {
    expect(directReads("const keys = getReadonlyStateKeys(owner.flow.session?.stateSchema);")).toHaveLength(1);
    expect(directReads("const s = targetFlow.user.stateSchema;")).toHaveLength(1);
    expect(directReads("  // reads flow.session?.stateSchema, which is fine in a comment")).toHaveLength(0);
  });
});
