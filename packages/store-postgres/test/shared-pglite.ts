/**
 * One PGlite per test file.
 *
 * Starting a PGlite (a full embedded Postgres) costs about two seconds, and
 * the tests themselves take milliseconds, so a fresh instance per test made
 * this package the slowest suite in CI. Instead, each test file that imports
 * this module gets one instance, and every call to {@link freshPglite} drops
 * and recreates the `public` schema, so the caller still starts from a
 * database with no tables and no rows. The instance is closed once, after the
 * file's last test.
 *
 * Vitest evaluates each test file in its own module graph, so the instance is
 * never shared across files.
 *
 * Tests that need two databases alive at the same time, or a brand-new
 * instance on purpose, still construct `new PGlite()` themselves.
 */
import { afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let instance: PGlite | undefined;

/**
 * Return this file's PGlite with an empty `public` schema. Do not `close()`
 * it: the next test reuses it, and this module closes it after the file.
 */
export async function freshPglite(): Promise<PGlite> {
  instance ??= new PGlite();
  await instance.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  return instance;
}

afterAll(async () => {
  await instance?.close();
  instance = undefined;
});
