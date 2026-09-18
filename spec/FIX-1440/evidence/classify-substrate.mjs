#!/usr/bin/env node
/**
 * Re-derives the spec's factual base: every file in the repo that mentions the
 * child / nested / detached session substrate, and which side of the cut it
 * falls on.
 *
 * The spec claims a specific split — a read-only *viewing* surface that can be
 * deleted, and a *dispatch-internal* derived session that cannot. That claim is
 * a count, and a count that nobody re-derives goes stale the first time someone
 * lands a file. So this asserts it instead of stating it.
 *
 * The assertion that matters is **totality**: every matching tracked file is
 * classified, so a file nobody listed fails the run rather than passing
 * unnoticed. Spot-checking the files we already knew about would report nothing
 * new by construction.
 *
 * Run: node spec/FIX-1440/evidence/classify-substrate.mjs
 *      node spec/FIX-1440/evidence/classify-substrate.mjs --negative-control
 *
 * `--negative-control` plants an unclassified matching file, so you can watch
 * the totality assertion actually go red before trusting a green one.
 *
 * Known limit: the corpus is defined by the literal TERMS below, so a file that
 * describes the substrate without spelling one of them is outside it.
 * `packages/engine/src/context/dispatch-operation.ts` is the one such file the
 * survey found — it starts the request a dispatch becomes, and its prose says
 * "adopts a child" rather than "child session". It is dispatch-side, and the
 * spec treats it as such; it is named here rather than silently missing.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");

/** The terms that name the substrate. Anything matching these is in the corpus. */
const TERMS = [
  "listChildSessions",
  "handleListSessionChildren",
  "child-session",
  "childSession",
  "ChildSession",
  "detached-child",
  "detachedChild",
  "deriveDispatchChildSessionId",
  "maxChildSessionListLimit",
  "parentSessionId",
  "isDescendantSession",
  "matchesParentageFilter",
  "/children",
  "child session",
  "nested session"
];

/**
 * VIEWING — the surface that teaches a session tree as the work hierarchy.
 * This is what the spec removes. Nothing in the execution path reads it.
 */
const VIEWING = [
  // engine — the route, its wiring, its config ceiling
  "packages/engine/src/routes/child-session-routes.ts",
  "packages/engine/src/routes/router.ts",
  "packages/engine/src/routes/index.ts",
  "packages/engine/src/routes/http-handlers.ts",
  "packages/engine/src/routes/createFlowApiRouter.ts",
  "packages/engine/src/runtime-config.ts",
  "packages/engine/test/child-session-listing-route.test.ts",
  // client — listChildSessions + the ChildSessionSummary contract
  "packages/client/src/session-client/sessions.ts",
  "packages/client/src/types/index.ts",
  "packages/client/src/index.ts",
  "packages/client/test/sessions.test.ts",
  "packages/client/README.md",
  // react — SessionView.childSessions
  "packages/react/src/hooks/useSession.ts",
  "packages/react/src/index.ts",
  "packages/react/test/useSession-child-sessions.test.ts",
  "packages/react/README.md",
  // devtool — the Children tab and everything typed on ChildSessionSummary
  "packages/devtool/src/react/components/workspace/child-sessions-view.tsx",
  "packages/devtool/src/react/components/workspace/task-collections-view.tsx",
  "packages/devtool/src/react/hooks/use-child-sessions.ts",
  "packages/devtool/src/react/hooks/use-session-requests.ts",
  "packages/devtool/src/react/hooks/use-session-state.ts",
  "packages/devtool/src/react/lib/child-session-links.ts",
  "packages/devtool/src/react/lib/instance-ownership.ts",
  "packages/devtool/src/react/lib/task-collection-state.ts",
  "packages/devtool/src/react/lib/utils.ts",
  "packages/devtool/src/react/context/devtool-context.tsx",
  "packages/devtool/src/react/DevToolPanel.tsx",
  "packages/devtool/test/use-child-sessions.test.ts",
  "packages/devtool/test/child-sessions-view.test.tsx",
  "packages/devtool/test/child-session-links.test.ts",
  "packages/devtool/test/use-session-requests.test.ts",
  "packages/devtool/test/task-collection-state.test.ts",
  "packages/devtool/test/task-collections-view.test.tsx",
  "packages/devtool/test/devtool-panel-cross-owner.test.tsx",
  "packages/devtool/test/devtool-panel-owned-subtree.test.tsx",
  "packages/devtool/test/devtool-panel-session-reset.test.tsx",
  // kitchen-sink — the demo that teaches it
  "apps/kitchen-sink/components/background-work-panel.tsx",
  "apps/kitchen-sink/e2e/background-work.spec.ts",
  "apps/kitchen-sink/CLAUDE.md",
  // published docs that teach the read surface
  "apps/docs/docs/server/background-work.md",
  "apps/docs/docs/client/overview.md",
  "apps/docs/docs/client/react.md",
  "apps/docs/docs/api/client.md",
  "apps/docs/docs/api/react.md",
  "apps/docs/docs/configuration/runtime.md",
  "apps/docs/guides/background-work.md",
  "apps/docs/docs/devtool/overview.md",
  "apps/docs/docs/server/setup.md",
  "apps/docs/docs/server/authentication.md",
  "packages/engine/README.md",
  "docs/architecture/server-and-client.md"
];

/**
 * DISPATCH — the derived session a dispatched row runs in, and the parent-chain
 * walk that authorises settle / interrupt / liveness over it. The spec KEEPS
 * these. `goals/task-board/hands-a-row-to-a-worker-in-its-own-session` asserts
 * this behaviour and passes today; deleting them takes it red.
 */
const DISPATCH = [
  // the derived session and the seam that mints/adopts it
  "packages/engine/src/context/detached-child.ts",
  "packages/engine/src/context/createExecutionContext.ts",
  "packages/engine/src/execution/transport-sources.ts",
  "packages/engine/test/context/seam-harness.ts",
  "packages/engine/test/lineage-address-ownership.test.ts",
  "packages/engine/src/context/create-request-host.ts",
  "packages/engine/src/context/liveness-read.ts",
  "packages/engine/test/context/detached-child.test.ts",
  "packages/engine/test/context/dispatch-seam.test.ts",
  "packages/engine/test/context/dispatch-cross-flow.test.ts",
  "packages/engine/test/context/liveness-read.test.ts",
  "packages/engine/test/context/request-host-create-race.test.ts",
  "packages/engine/test/context/request-host-lineage-root.test.ts",
  "packages/engine/test/context/request-host-shipped-path.test.ts",
  // the record field + parentage filter every store implements
  "packages/engine/src/stores/types.ts",
  "packages/engine/src/stores/memory/session-store.ts",
  "packages/engine/src/stores/filesystem/session-store.ts",
  "packages/engine/src/stores/scope-keys.ts",
  "packages/store-sqlite/src/session-store.ts",
  "packages/store-postgres/src/session-store.ts",
  "packages/engine/test/session-parentage-listing.test.ts",
  "packages/engine/test/scope-keys-parentage.test.ts",
  "packages/engine/test/list-option-widenings.test.ts",
  "packages/engine/test/shared-to-lineage.test.ts",
  "packages/engine/test/shared-to-lineage-ownership.test.ts",
  "packages/store-sqlite/test/session-parentage.test.ts",
  "packages/store-sqlite/test/list-option-widenings.test.ts",
  "packages/store-postgres/test/session-parentage.test.ts",
  "packages/store-postgres/test/list-option-widenings.test.ts",
  // runtime + transport that start and drain a dispatched run
  "packages/engine/src/flowstate/createFlowState.ts",
  "packages/engine/src/flowstate/types.ts",
  "packages/engine/src/transports/host/createInboundTransportHost.ts",
  "packages/engine/test/flowstate/runtime-dispatch.test.ts",
  "packages/engine/test/transports/external-dispatch-queued-liveness.test.ts",
  // consumers of the dispatch contract
  "packages/core/src/types/dispatch.ts",
  "packages/core/README.md",
  "packages/harness-manager/src/manager.ts",
  "packages/harness-manager/src/run-record.ts",
  "packages/integration-tests/src/scenarios/task-board-hand-off-on-error.test.ts",
  "packages/orchestration/test/task-board/hand-off-session-scope.test.ts",
  "labs/conductor/test/manager.spec.ts",
  // the acceptance check that asserts a dispatched row runs in its own session
  "goals/task-board/hands-a-row-to-a-worker-in-its-own-session/run.mts",
  // internal architecture describing the mechanism
  "docs/architecture/dispatched-work.md",
  "docs/architecture/state-and-scopes.md",
  "docs/architecture/action-forms.md",
  "docs/contributing/architecture-reference.md",
  "apps/docs/docs/persistence/overview.md",
  "apps/kitchen-sink/flows/chat-agent/run/thinking-styles/pipelines/background-work.ts"
];

/**
 * DISPATCH by subtree — packages and trees whose every match is dispatch/hand-off
 * machinery built on the derived session. Deliberately excludes `packages/engine/src/`,
 * so the negative control's planted file there still falls through to `other`:
 * a subtree rule that swallowed it would disable the assertion it exists to prove.
 */
const DISPATCH_SUBTREES = [
  "packages/orchestration/",
  "packages/claude-code/",
  "packages/harness-manager/",
  "packages/bullmq/",
  "packages/patterns/",
  "packages/cli/",
  "packages/tools/",
  "packages/integration-tests/",
  "packages/workforce/",
  "packages/core/",
  "packages/store-sqlite/",
  "packages/store-postgres/",
  "labs/",
  "goals/",
  "scripts/",
  "apps/kitchen-sink/",
  "docs/architecture/",
  "apps/docs/docs/orchestration/",
  "apps/docs/docs/tools/",
  "apps/docs/docs/cli/",
  "apps/docs/docs/fundamentals/",
  "apps/docs/docs/resources/",
  "apps/docs/docs/persistence/",
  "apps/docs/guides/background-jobs-bullmq.md",
  "docs/contributing/"
];

/** Subtrees whose matches are records, not live surface. */
const RECORD_SUBTREES = [
  "docs/internal/",
  "docs/atlas/",
  "spec/",
  ".changeset/"
];

/** Files matching a term incidentally (a changelog line, an unrelated sense). */
const INCIDENTAL_SUFFIXES = ["CHANGELOG.md"];

function tracked() {
  const out = execFileSync("git", ["grep", "-l", "-E", TERMS.join("|"), "--", "."], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  return out.split("\n").filter(Boolean);
}

function classify(path) {
  if (VIEWING.includes(path)) return "viewing";
  if (DISPATCH.includes(path)) return "dispatch";
  if (DISPATCH_SUBTREES.some((p) => path.startsWith(p))) return "dispatch";
  if (RECORD_SUBTREES.some((p) => path.startsWith(p))) return "record";
  if (INCIDENTAL_SUFFIXES.some((s) => path.endsWith(s))) return "incidental";
  return null;
}

const negativeControl = process.argv.includes("--negative-control");
const plantedPath = "packages/engine/src/__planted-unclassified.ts";

if (negativeControl) {
  writeFileSync(
    `${REPO}/${plantedPath}`,
    "// planted by --negative-control\nexport const x = { parentSessionId: '' };\n"
  );
  execFileSync("git", ["add", "-N", plantedPath], { cwd: REPO });
}

let failed = false;

try {
  const files = tracked();
  const buckets = { viewing: [], dispatch: [], record: [], incidental: [], other: [] };

  for (const f of files) {
    const bucket = classify(f);
    buckets[bucket ?? "other"].push(f);
  }

  for (const [name, list] of Object.entries(buckets)) {
    console.log(`${name.padEnd(11)} ${String(list.length).padStart(3)}`);
  }

  // Totality. A file nobody classified is the failure this exists to catch.
  if (buckets.other.length > 0) {
    console.error(`\nFAIL — ${buckets.other.length} matching file(s) classified by nothing:`);
    for (const f of buckets.other) console.error(`  ${f}`);
    console.error(
      "\nEither it belongs in VIEWING/DISPATCH (and the spec's scope is wrong),\n" +
        "or it is a record/incidental match (and the rule above is wrong). Decide, don't widen."
    );
    failed = true;
  }

  // Each declared path must still exist — a rename silently empties a bucket.
  const missing = [...VIEWING, ...DISPATCH].filter((p) => !files.includes(p));
  if (missing.length > 0) {
    console.error(`\nFAIL — declared path(s) no longer match the corpus:`);
    for (const m of missing) console.error(`  ${m}`);
    failed = true;
  }

  if (!failed) console.log(
    `\nPASS — ${files.length} matching files, all classified; ` +
      `${buckets.viewing.length} in the removal scope, ${buckets.dispatch.length} kept as dispatch internals.`
  );
} finally {
  if (negativeControl) {
    execFileSync("git", ["rm", "--cached", "-q", "--force", plantedPath], { cwd: REPO });
    rmSync(`${REPO}/${plantedPath}`, { force: true });
  }
}

// Set after the finally, so a failing run still cleans up what it planted.
process.exitCode = failed ? 1 : 0;
