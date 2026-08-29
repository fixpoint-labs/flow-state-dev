/**
 * The lab bin can put `conductor` on PATH. The config door is unchanged.
 */
import { describe, expect, it } from "vitest";
import { lstatSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  conductorHomeBin,
  installConductorOnPath,
  isConductorBinInstall,
  pathHasDir,
} from "../bin/install.mjs";

const labRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(labRoot, "bin", "conductor.mjs");

describe("isConductorBinInstall", () => {
  it("is only the bare install verb", () => {
    expect(isConductorBinInstall(["install"])).toBe(true);
    expect(isConductorBinInstall(["install", "FIX-1"])).toBe(false);
    expect(isConductorBinInstall(["status"])).toBe(false);
    expect(isConductorBinInstall([])).toBe(false);
  });
});

describe("installConductorOnPath", () => {
  it("symlinks the bin under ~/.local/bin", () => {
    const home = path.join(tmpdir(), `conductor-install-${process.pid}-${Date.now()}`);
    const dest = installConductorOnPath(bin, { HOME: home });
    expect(dest).toBe(conductorHomeBin(home));
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(readlinkSync(dest)).toBe(path.resolve(bin));
    expect(installConductorOnPath(bin, { HOME: home })).toBe(dest);
    expect(readlinkSync(dest)).toBe(path.resolve(bin));
    expect(pathHasDir(dest, `${path.dirname(dest)}${path.delimiter}/usr/bin`)).toBe(true);
    expect(pathHasDir(dest, "/usr/bin")).toBe(false);
  });

  it("replaces an existing symlink and refuses a regular file", () => {
    const home = path.join(tmpdir(), `conductor-install-file-${process.pid}-${Date.now()}`);
    const dest = conductorHomeBin(home);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, "not a symlink\n");
    expect(() => installConductorOnPath(bin, { HOME: home })).toThrow(/not a symlink/);
  });

  it("refuses when HOME is unset", () => {
    expect(() => installConductorOnPath(bin, {})).toThrow(/HOME is unset/);
  });
});

describe("conductor.mjs install", () => {
  it("writes the symlink and does not exec fsdev", () => {
    const home = path.join(tmpdir(), `conductor-install-bin-${process.pid}-${Date.now()}`);
    const result = spawnSync(process.execPath, [bin, "install"], {
      env: { ...process.env, HOME: home, PATH: "/usr/bin" },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(conductorHomeBin(home));
    expect(result.stderr).toMatch(/add .* to PATH/);
    expect(lstatSync(conductorHomeBin(home)).isSymbolicLink()).toBe(true);
  });
});
