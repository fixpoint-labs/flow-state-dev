/**
 * Kitchen Sink's registry copies: which registry components it installs in
 * `components/flow-state/`, held byte-identical to `packages/ui/registry`.
 *
 * One options object, read by both sides: `test/registry-drift.test.ts`
 * checks the copies with it, and `scripts/refresh-registry-copies.ts`
 * (`pnpm registry:refresh`) writes them with it, so what is copied is what is
 * checked. After editing a registry component, run the refresh; the drift
 * test fails if it was forgotten.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegistryCopyOptions } from "../../../packages/ui/scripts/registry-drift";

/**
 * Files under `components/flow-state/` with no registry source, kept
 * app-only on purpose. Each entry needs a reason — this is an explicit
 * allowlist, not a pattern exclusion, so a future fork with no source
 * still fails loudly instead of matching a wildcard meant for something
 * else.
 */
const APP_ONLY_FILES: Record<string, string> = {};

/**
 * Kitchen Sink follows sessions through `useSession`, so it draws neither the
 * connection bar nor the first-read screen. The request-recovery line is not
 * installed here either, nor the task action row, which no screen here opens
 * a task to draw, nor the task time signal, which no screen here lists a
 * board's rows to draw. The harness readiness chips aren't installed either:
 * the picker shows each mode's readiness itself. An installed copy nothing
 * imports is dead code.
 */
const NOT_INSTALLED_COMPONENTS = new Set([
  "connection-banner.tsx",
  "connection-screen.tsx",
  "task-actions.tsx",
  "harness-readiness.tsx",
  "task-signals.tsx",
  // Kitchen Sink draws no background task's feed, so nothing here says what one is doing now.
  "working-status.ts",
  // The session overlay is the labs' popup over a session; Kitchen Sink opens no such popup.
  "session-overlay.tsx",
]);

/** Kitchen Sink's registry copies, as both the drift test and the refresh read them. */
export const KITCHEN_SINK_REGISTRY_COPIES: RegistryCopyOptions = {
  targetDir: join(dirname(fileURLToPath(import.meta.url)), "../components/flow-state"),
  notInstalled: (file) => file.startsWith("generative/") || NOT_INSTALLED_COMPONENTS.has(file),
  appOnly: APP_ONLY_FILES,
};
