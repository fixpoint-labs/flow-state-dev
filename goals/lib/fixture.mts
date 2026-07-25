/**
 * Held-out fixture loading.
 *
 * Every goal reads its inputs from a sibling `fixtures/` directory rather than
 * hardcoding them, so swapping the fixture for another valid one still passes a
 * correct implementation (README → "Input"). Callers pass their own
 * `import.meta.url` so the path resolves relative to the goal, not to this file.
 *
 *   const fx = loadFixture<{ note: string }>(import.meta.url, "note.json");
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Absolute path to a goal's `fixtures/` directory. */
export function fixtureDir(runUrl: string): string {
  return fileURLToPath(new URL("./fixtures", runUrl));
}

/** Absolute path to one file inside a goal's `fixtures/` directory. */
export function fixturePath(runUrl: string, name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, runUrl));
}

/**
 * Read and parse a held-out JSON fixture. The type parameter is the caller's
 * assertion about the fixture's shape — it is not validated here, deliberately:
 * a goal that mis-describes its own fixture should fail on the assertion that
 * depends on it, where the message is meaningful.
 */
export function loadFixture<T>(runUrl: string, name = "input.json"): T {
  return JSON.parse(readFileSync(fixturePath(runUrl, name), "utf8")) as T;
}

/** Read a non-JSON held-out fixture (an OFX export, an HTML filing) verbatim. */
export function loadFixtureText(runUrl: string, name: string): string {
  return readFileSync(fixturePath(runUrl, name), "utf8");
}
