/**
 * The one spec that touches the real `@cursor/sdk`.
 *
 * Every other spec here scripts the client, which proves the block and proves
 * nothing about the SDK. This one loads the **installed** package and holds the
 * two premises the version gate's promise rests on: that the entry points this
 * package drives are still where it expects them, and that the reader finds
 * exactly the pinned version against the real on-disk layout.
 *
 * That is the enforcement half of the gate. The gate says a host may not run an
 * untested wire; this is what makes "tested" mean something, and it goes red when
 * a Cursor bump moves the surface.
 *
 * **It does not exercise a real run, and cannot.** Cursor's local runtime is a
 * platform-specific native binary talking to Cursor's backend, with no path
 * override and no offline mode, so there is no subprocess-level fake to point it
 * at the way `@flow-state-dev/codex` points the Codex SDK at a fake `codex`
 * binary. A live end-to-end check needs an API key and belongs in `goals/`, not
 * in CI. What CAN be held here is held here.
 */
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readInstalledCursorSdkVersion } from "../src/cursor-client";
import { createDefaultResolveCursorClient } from "../src/cursor-client";
import { CursorSdkNotInstalledError } from "../src/errors";
import { TESTED_SDK_VERSION } from "../src/types";
import { cursorProjectName, cursorWorkingDirectory } from "../src/workspace-alias";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `Agent.create` on the real SDK in a child whose home is `home`, with a key
 * the SDK refuses locally: it opens its state directory for `cwd` first, so
 * the message says whether that directory could be made, and nothing reaches
 * the network. A child, so this process's home is never changed.
 */
async function createIn(home: string, cwd: string): Promise<string> {
  const script =
    'import { Agent } from "@cursor/sdk";' +
    "try { await Agent.create({ model: { id: 'composer-2.5' }, apiKey: 'not-a-key', local: { cwd: process.argv[1] } }); console.log('created'); }" +
    " catch (e) { console.log(String(e?.message ?? e)); } process.exit(0);";
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, cwd], {
    cwd: PACKAGE_DIR,
    env: { ...process.env, HOME: home, USERPROFILE: home, CURSOR_DATA_DIR: "" },
    timeout: 30_000,
  });
  return stdout.trim();
}

describe("the installed SDK", () => {
  it("reads exactly the pinned version off the SDK installed in this workspace", async () => {
    // The devDependency is pinned to the tested version, so the default reader
    // must find exactly it — proving the reader works against the real layout
    // and not only against a stub. Note the SDK's `exports` map publishes no
    // `./package.json`, so this cannot be done by asking the module resolver.
    expect(readInstalledCursorSdkVersion()).toEqual({
      kind: "version",
      version: TESTED_SDK_VERSION,
    });
  });

  it("exports an `Agent` with the `create` and `resume` this package drives", async () => {
    const sdk = await import("@cursor/sdk");
    expect(typeof sdk.Agent?.create).toBe("function");
    expect(typeof sdk.Agent?.resume).toBe("function");
  });

  it("the default resolver adapts that `Agent` without constructing anything", async () => {
    // Resolving must not start a runtime or reach the network: a host builds the
    // block long before it runs one, and `create` is not called here.
    const resolved = await createDefaultResolveCursorClient()({} as never);
    expect(typeof resolved.create).toBe("function");
    expect(typeof resolved.resume).toBe("function");
  });

  it("a missing SDK surfaces on the first RUN as an install hint, not at import", async () => {
    const resolve = createDefaultResolveCursorClient(() => {
      throw new Error("Cannot find package '@cursor/sdk'");
    });
    await expect(resolve({} as never)).rejects.toBeInstanceOf(CursorSdkNotInstalledError);
  });

  it("an SDK that loads but exports no usable `Agent` is refused by name", async () => {
    const resolve = createDefaultResolveCursorClient(async () => ({ Agent: {} }));
    await expect(resolve({} as never)).rejects.toThrow(/does not export an `Agent`/);
  });

  it("opens its state for a checkout too deep to name only through the block's short link", async () => {
    // The premise and the fix in one place. The real SDK names its state
    // directory after the whole working directory, so a deep checkout fails
    // before any work (the control), and the link the block hands it instead
    // gets past that to the SDK's next check. The state directory it made is
    // the name this package predicts, so the prediction tracks the SDK.
    const base = await mkdtemp(join(tmpdir(), "cursor-sdk-deep-"));
    const home = join(base, "home");
    const deep = join(base, "r".repeat(100), "u".repeat(100), "n".repeat(60));
    await mkdir(home);
    await mkdir(deep, { recursive: true });
    try {
      expect(await createIn(home, deep)).toMatch(/ENAMETOOLONG/);

      const link = await cursorWorkingDirectory(deep);
      const outcome = await createIn(home, link);
      expect(outcome).not.toMatch(/ENAMETOOLONG/);
      expect(outcome).toMatch(/API key/i);
      expect(await readdir(join(home, ".cursor", "projects"))).toEqual([cursorProjectName(link)]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 60_000);
});
