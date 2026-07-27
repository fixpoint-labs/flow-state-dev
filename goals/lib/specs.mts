/**
 * Running an app's real-path vitest specs as a goal check.
 *
 * Three trading-desk goals prove a model-free, deterministic path (portfolio
 * math over real PGlite) whose contract is already pinned end to end by specs
 * that use no mocks. Rather than restate that wiring, those goals execute the
 * specs by hand, outside the default lane.
 *
 * Worth being honest about the tension: the README frames a goal check as the
 * thing a mocked CI spec cannot do, so a goal whose body is `vitest run` is
 * only legitimate when the named specs genuinely drive production code with no
 * mocks. Each caller documents that claim in its header. If a spec on this list
 * ever grows a mock, the goal built on it stops being a goal.
 */
import { execFileSync } from "node:child_process";

/** Run `vitest run <specs>` in `app`. Returns true when every spec passed. */
export function runSpecs(app: string, specs: string[]): boolean {
  try {
    execFileSync("pnpm", ["exec", "vitest", "run", ...specs], { stdio: "inherit", cwd: app });
    return true;
  } catch {
    return false;
  }
}
