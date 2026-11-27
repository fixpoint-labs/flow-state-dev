/**
 * The checks and setup settings: `fsdev.config.mts` reads the checks from
 * `TEAMMATES_CHECKS` and the setup command from `TEAMMATES_SETUP`; a command a
 * shell would be needed for stops the lab at start. What a check does to a
 * run is the harness kit's (`harness-manager`'s `coding-phase.spec.ts`).
 */
import { describe, expect, it } from "vitest";
import { checkCommands, setupCommand } from "../host.mts";

describe("the checks and setup settings", () => {
  it("read nothing when unset or blank", () => {
    expect(checkCommands(undefined)).toBeUndefined();
    expect(checkCommands("  ")).toBeUndefined();
    expect(setupCommand(undefined)).toBeUndefined();
  });

  it("read `;`-separated checks and one setup command, split into words", () => {
    expect(checkCommands("pnpm typecheck; pnpm --filter web test")).toEqual(["pnpm typecheck", "pnpm --filter web test"]);
    expect(setupCommand("pnpm install --frozen-lockfile")).toEqual({ command: ["pnpm", "install", "--frozen-lockfile"] });
  });

  it("refuse a command that needs a shell, naming the setting", () => {
    expect(() => checkCommands("pnpm build && pnpm test")).toThrow(/TEAMMATES_CHECKS: .*shell operator/);
    expect(() => setupCommand("pnpm install | tee log")).toThrow(/TEAMMATES_SETUP: .*shell operator/);
    expect(() => setupCommand("pnpm install; pnpm build")).toThrow(/TEAMMATES_SETUP: .*shell operator/);
  });
});
