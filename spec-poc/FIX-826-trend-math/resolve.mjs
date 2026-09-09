/**
 * Locate an installed `labs/trading-desk` so these POCs can `require("trading-signals")`
 * against the version the desk actually pins.
 *
 * In a normal checkout the sibling path just works. A git worktree has no
 * `node_modules` of its own, so set `TRADING_DESK_DIR` to an installed checkout:
 *
 *   TRADING_DESK_DIR=/path/to/flow-state-dev/labs/trading-desk node <script>
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function resolveFromTradingDesk() {
  const candidates = [];
  if (process.env.TRADING_DESK_DIR) {
    candidates.push(path.resolve(process.env.TRADING_DESK_DIR));
  }
  candidates.push(
    path.resolve(fileURLToPath(new URL("../../labs/trading-desk", import.meta.url))),
  );

  for (const dir of candidates) {
    if (existsSync(path.join(dir, "node_modules", "trading-signals"))) {
      return path.join(dir, "package.json");
    }
  }

  throw new Error(
    `Could not find an installed trading-signals. Tried:\n  ${candidates.join("\n  ")}\n` +
      `Run \`pnpm install\` in the repo, or set TRADING_DESK_DIR to an installed checkout's labs/trading-desk.`,
  );
}
