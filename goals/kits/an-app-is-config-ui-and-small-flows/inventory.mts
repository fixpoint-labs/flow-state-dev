/**
 * `a:inventory`, graded on a lab folder: the shared inventory rules
 * (`labs/test-support/inventory.mts`) with the lab's own settings
 * (`labs/claude-code-style/test/inventory-settings.ts`), which its
 * `pnpm test` runs, held to the closure's D1 with no file exempt and no
 * allowlist, plus the repo-wide own-session rule. One inventory: this file
 * only runs those rules.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../lib/index.mts";
import { findings, OWN_SESSION_PATTERN, type Rule } from "../../../labs/test-support/inventory.mts";
import { claudeCodeStyle } from "../../../labs/claude-code-style/test/inventory-settings.ts";

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
  const found = findings({ ...claudeCodeStyle, root: lab });
  const rule = (name: Rule) => found.filter((f) => f.rule === name).map((f) => f.detail);
  return {
    adapter: ["src/adapter.ts", "test/fake-lab.ts"].filter((rel) => existsSync(join(lab, rel))).map((rel) => `${rel} is there`),
    "workforce code": existsSync(join(lab, "workforce")) ? walk(join(lab, "workforce")).filter((rel) => !rel.endsWith(".md")).map((rel) => `workforce/${rel}`) : [],
    "L1 classes": rule("L1"),
    "L2 caps": rule("L2"),
    "L3 reaches the server": rule("L3"),
    "L4 types": rule("L4"),
    "H host wiring": rule("H"),
    "S own sessions": grepRepo(OWN_SESSION_PATTERN, PRODUCT, rev),
  };
}

function walk(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
}
