#!/usr/bin/env node
/**
 * The super app's build: Kitchen Sink once more, under its sub-route.
 *
 * Next reads `basePath` at build time, so the root-served build turbo makes in
 * `.next` can't serve at `/kitchen-sink`. This builds a second one into
 * `.next-super-app` with the prefix set (`KITCHEN_SINK_ENV`); `run.mjs serve`
 * starts it with the same env. The labs' pages need nothing extra: they build
 * with relative asset URLs, and turbo builds them before this (`^build`).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { KITCHEN_SINK_ENV, REPO } from "./apps.mjs";

const result = spawnSync("pnpm", ["run", "build"], {
  cwd: join(REPO, "apps/kitchen-sink"),
  env: { ...process.env, ...KITCHEN_SINK_ENV },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
