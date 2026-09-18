/**
 * Acceptance check for FIX-1440 — are dispatch-run sessions first-class on their flow?
 *
 * Replaces `classify-substrate.mjs`, which was built for the superseded removal: its
 * totality assertion required a "removal scope" bucket to reach zero files, and under
 * the amended direction almost nothing is removed, so that assertion became meaningless.
 *
 * This one is **goal-shaped rather than descriptive**. It asserts the END STATE the spec
 * promises, which means it is **RED at spec time by design** and turns green when the work
 * lands. A green run here before implementation would mean the check is not reaching the
 * thing it claims to cover (BP-003, tenet 7).
 *
 * SCOPE, stated so a reader does not over-trust a green run. This checks the *corpus* — which
 * modules exist and what published prose says. The DevTool behaviour D1 and D5 specify (one level
 * of indent, the spawned/re-used label, the parent link, and a run's activity staying unloaded
 * until asked for) is **not** assertable at file level without dictating a layout, so it is
 * covered by the component tests in `PLAN.md → Checks` instead. A green run here means the descent
 * is gone, not that its replacement is right.
 *
 * Two kinds of assertion, and both earn their place:
 *
 *   - MUST APPEAR — the door this change opens. Red now.
 *   - MUST NOT APPEAR — the descent teaching this change removes. Red now.
 *   - MUST SURVIVE — the provenance route and the derivation. **Green now**, and they are
 *     here to catch the opposite failure: a zealous implementation that deletes what the
 *     owner amendment explicitly said to keep.
 *
 * Usage:
 *      node spec/FIX-1440/evidence/first-class-dispatch-runs.mjs
 *      node spec/FIX-1440/evidence/first-class-dispatch-runs.mjs --negative-control
 *
 * `--negative-control` inverts one MUST-SURVIVE assertion by hiding the file it checks,
 * so you can watch a passing assertion go red before trusting any green.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");

const read = (p) => (existsSync(join(REPO, p)) ? readFileSync(join(REPO, p), "utf8") : undefined);

/** Every tracked file, so a docs sweep cannot miss a page nobody remembered. */
function tracked() {
  return execSync("git ls-files", { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);
}

/**
 * The checks. Each carries `fails` — the sentence that says what would make it go red.
 * A check without one is not a check, it is a wish.
 */
const CHECKS = [
  {
    id: "listing-opts-in",
    phase: "MUST APPEAR",
    why: "S1 — the route can ask for dispatch runs",
    fails: "if handleListSessions still never passes a parentage option, the run stays unfindable",
    run: () => {
      const src = read("packages/engine/src/routes/session-routes.ts");
      if (src === undefined) return { ok: false, note: "session-routes.ts is missing" };
      const listFn = src.slice(src.indexOf("export async function handleListSessions"));
      const body = listFn.slice(0, listFn.indexOf("\n}\n"));
      return {
        ok: /parentage/.test(body),
        note: /parentage/.test(body)
          ? "handleListSessions threads a parentage option"
          : "handleListSessions passes no parentage option — dispatch runs cannot be listed"
      };
    }
  },
  {
    id: "wire-name-is-not-a-storage-concept",
    phase: "MUST NOT APPEAR",
    why: 'S2 — callers should not learn the store enum. `parentage="all"` on the wire couples HTTP to storage',
    fails: 'if the route reads a query param literally named "parentage", the store enum has leaked to callers',
    run: () => {
      const src = read("packages/engine/src/routes/session-routes.ts") ?? "";
      const leaked = /searchParams\.get\(\s*["']parentage["']\s*\)/.test(src);
      return {
        ok: !leaked,
        note: leaked ? 'the route reads a "parentage" query param verbatim' : "no storage enum on the wire"
      };
    }
  },
  {
    id: "no-devtool-descent",
    phase: "MUST NOT APPEAR",
    why: "S5 — the recursive Children tab is the strongest nest-as-org-chart teaching. Its replacement is an indented listing and an in-place load (D5), neither of which is a descent",
    fails: "if any devtool child-session view/hook/links module still exists, the descent survives",
    run: () => {
      const present = tracked().filter(
        (p) => /^packages\/devtool\/.*child-session/i.test(p) || /^packages\/devtool\/.*use-child-sessions/i.test(p)
      );
      return {
        ok: present.length === 0,
        note: present.length === 0 ? "no descent modules" : `${present.length} still present: ${present.join(", ")}`
      };
    }
  },
  {
    id: "docs-do-not-teach-a-nest",
    phase: "MUST NOT APPEAR",
    why: "S9 — published prose is where a reader learns the tree",
    fails: "if a published page still says children nest, the teaching outlived the code change",
    run: () => {
      const NEST = /children can nest|child of a child|nested child session|child sessions of a child/i;
      const hits = tracked()
        .filter((p) => p.startsWith("apps/docs/") || /^packages\/[^/]+\/README\.md$/.test(p))
        .filter((p) => NEST.test(read(p) ?? ""));
      return {
        ok: hits.length === 0,
        note: hits.length === 0 ? "no nest teaching in published prose" : `nest teaching in: ${hits.join(", ")}`
      };
    }
  },
  {
    id: "provenance-route-survives",
    phase: "MUST SURVIVE",
    why: "D1 and the owner amendment — /children stays as a provenance index",
    fails: "if the route file is deleted, the implementation over-applied the superseded removal",
    run: () => {
      const ok = existsSync(join(REPO, "packages/engine/src/routes/child-session-routes.ts"));
      return { ok, note: ok ? "provenance route present" : "provenance route was deleted — that is the OLD direction" };
    }
  },
  {
    id: "derivation-untouched",
    phase: "MUST SURVIVE",
    why: "D2's boundary — the rename moves names, not bytes",
    fails: "if the dsx_ prefix or the cross-flow discriminator moved, in-flight runs strand for a lease period",
    run: () => {
      // Either filename is acceptable: S8 renames the module, and the check is about
      // the id material surviving the rename, not about where it lives.
      const src = read("packages/engine/src/context/dispatch-run.ts")
        ?? read("packages/engine/src/context/detached-child.ts");
      if (src === undefined) return { ok: false, note: "neither dispatch-run.ts nor detached-child.ts found" };
      const prefix = /dsx_/.test(src);
      const material = /framed\(identity\.parentSessionId\)/.test(src) && /framed\(identity\.lineageId\)/.test(src);
      return {
        ok: prefix && material,
        note: prefix && material ? "prefix and hash material intact" : `prefix=${prefix} material=${material}`
      };
    }
  }
];

// --- negative control -------------------------------------------------------
// Hides the provenance route so a MUST-SURVIVE assertion is observed going red.
// Chosen deliberately: it is the one check that is GREEN today, so it is the only
// one whose flip actually demonstrates the harness works.
const negativeControl = process.argv.includes("--negative-control");
const routePath = join(REPO, "packages/engine/src/routes/child-session-routes.ts");
const hiddenPath = `${routePath}.__hidden`;

let failed = false;
try {
  if (negativeControl && existsSync(routePath)) renameSync(routePath, hiddenPath);

  const results = CHECKS.map((c) => ({ ...c, ...c.run() }));
  const width = Math.max(...results.map((r) => r.id.length));

  for (const phase of ["MUST APPEAR", "MUST NOT APPEAR", "MUST SURVIVE"]) {
    console.log(`\n${phase}`);
    for (const r of results.filter((x) => x.phase === phase)) {
      console.log(`  ${r.ok ? "green" : "RED  "}  ${r.id.padEnd(width)}  ${r.note}`);
      if (!r.ok) console.log(`         ${" ".repeat(width)}  why: ${r.why}`);
    }
  }

  const red = results.filter((r) => !r.ok);
  failed = red.length > 0;

  console.log("");
  if (failed) {
    console.log(`RED — ${red.length}/${results.length} assertions unmet: ${red.map((r) => r.id).join(", ")}`);
    console.log("Before implementation this is the expected state. After it, each RED names work still owed.");
  } else {
    console.log(`GREEN — all ${results.length} assertions met.`);
  }
} finally {
  if (negativeControl && existsSync(hiddenPath)) renameSync(hiddenPath, routePath);
}

process.exitCode = failed ? 1 : 0;
