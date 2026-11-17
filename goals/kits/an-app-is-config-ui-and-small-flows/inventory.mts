/**
 * `a:inventory`, graded on a lab folder: the lab's own inventory rules
 * (`labs/claude-code-style/test/inventory-rules.ts`, which its `pnpm test`
 * runs), held to the closure's D1 with no file exempt, plus the repo-wide
 * own-session rule. One inventory: this file only runs those rules.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../lib/index.mts";
import { hostWiring, overCaps, reachingTheServer, rowTypesNotOnTheList, unclassified } from "../../../labs/claude-code-style/test/inventory-rules.ts";

/** The own-session helpers the epic retires, named anywhere in product source. */
const OWN_SESSION = String.raw`\b(ownSessions?|labSessions?|rosterSession|readerSessionId|openReaderSession)\b`;

/** Where an own-session helper would live: product source, not the engine's or orchestration's internals, not tests. */
const PRODUCT = ["packages/*/src/**", "labs/*/src/**", "labs/*/*.mts", "apps/*/src/**", ":!packages/engine/src/**", ":!packages/orchestration/src/**", ":!**/test/**", ":!**/*.test.*"];

/** `git grep` lines matching `pattern` in `paths`; a grep that errors fails the run rather than reading as no match. */
export function grepRepo(pattern: string, paths: string[], rev?: string): string[] {
  try {
    return execFileSync("git", ["grep", "-nE", pattern, ...(rev === undefined ? [] : [rev]), "--", ...paths], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 24 }).split("\n").filter(Boolean);
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

/** Each rule's findings on the lab at `lab`, the repo-wide rule read at `rev` (default the checkout); every list empty is a PASS. */
export function inventoryOf(lab: string, rev?: string): Record<string, string[]> {
  return {
    adapter: ["src/adapter.ts", "test/fake-lab.ts"].filter((rel) => existsSync(join(lab, rel))).map((rel) => `${rel} is there`),
    "workforce code": existsSync(join(lab, "workforce")) ? walk(join(lab, "workforce")).filter((rel) => !rel.endsWith(".md")).map((rel) => `workforce/${rel}`) : [],
    "L1 classes": unclassified(lab),
    "L2 caps": overCaps(lab),
    "L3 reaches the server": reachingTheServer(lab),
    "L4 row types": rowTypesNotOnTheList(lab),
    "H host wiring": existsSync(join(lab, "host.mts")) ? hostWiring(join(lab, "host.mts")) : [],
    "S own sessions": grepRepo(OWN_SESSION, PRODUCT, rev),
  };
}

function walk(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
}
