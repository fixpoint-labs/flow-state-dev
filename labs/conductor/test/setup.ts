/**
 * Put a fake `gh` on `PATH` for the whole suite.
 *
 * The implement phase's completion probe shells out to `gh`, and the phase now
 * refuses to build on a host where it cannot be run — a permanent failure that
 * otherwise lands after a paid coding run, once per retry. `implementPhase()`
 * is `conductorFlow`'s default phase, so that check runs at nearly every
 * construction in this suite.
 *
 * Without this the suite would pass or fail by whether the developer happens to
 * have `gh` installed, which is the opposite of what a fixture is for. The shim
 * makes the answer the same everywhere. It is deliberately inert: `--version`
 * is the only thing the preflight runs, and every test that reaches an actual
 * `gh pr list` stubs `prExists` instead.
 *
 * The two tests that care which answer the preflight gives set `PATH`
 * themselves, in both directions, so neither arm depends on this default.
 */
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";

const bin = mkdtempSync(join(tmpdir(), "conductor-fake-bin-"));
const gh = join(bin, "gh");
writeFileSync(gh, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi\nexit 1\n');
chmodSync(gh, 0o755);
process.env["PATH"] = `${bin}${delimiter}${process.env["PATH"] ?? ""}`;
