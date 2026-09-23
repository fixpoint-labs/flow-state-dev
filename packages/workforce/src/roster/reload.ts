/**
 * `reloadHiredSeats` — read a stored roster back at boot and turn it into
 * seats.
 *
 * **Store-side only. It admits nothing.** It reads rows, translates them and
 * hires them; registering the result is the caller's, one seat at a time. That
 * split is not tidiness. A batch admission keeps the entries admitted before a
 * refusal and ends the walk there, so the first refusable seat would take the
 * rest of the roster down with it and the boot would fail — which is the
 * degrade path broken by mechanism rather than by intent. Handing the seats
 * back and letting the caller loop is what makes "one bad row is one missing
 * seat" true.
 *
 * **Two failures stop the boot, and everything else degrades.** One rule, read
 * from two sides: *fail fast on what THIS deploy got wrong; degrade on what a
 * PAST deploy got wrong.*
 *
 *   - A read the store will not complete, and a roster larger than the cap,
 *     both **reject**. Both are transient and inherited from the environment,
 *     so a boot that fails is retried and whatever is already serving keeps
 *     serving. Neither returns a partial result: a short roster served as if
 *     it were the whole one is the failure being avoided, and a cap that
 *     quietly truncated would be that failure with extra steps.
 *   - A row that disagrees with the code — a kind that is gone, settings the
 *     kind now refuses, a shape nothing can parse, an org or seat id that
 *     cannot be an address — is **skipped, named, and returned in
 *     `problems`**. No retry fixes any of those, so failing the
 *     boot over one would mean an app that can never start until somebody
 *     reaches the database, and the hostage is every other org's team.
 *
 * `{ seats, problems }` matches what `openInventory` returns, on purpose: one
 * reader learns one word for the same idea, and the caller owns boot policy in
 * both cases. `problems` is the part to handle rather than log — "the roster"
 * and "what answers" are two numbers, and a warning in a log is not a report.
 *
 * Nothing here deletes or rewrites a row it could not use.
 */

import { withTimeout } from "@flow-state-dev/core/helpers";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { hireWorkforce, type HireOptions } from "../hire";
import { HIRED_ROSTER_PREFIX } from "./collections";
import { hiredSeatManifest, parseHiredSeatRow } from "./rows";

/**
 * The slice of a runtime's resource-state store this reads through.
 *
 * Structurally typed and satisfied by the engine's `StoreRegistry` directly,
 * for the reason `openInventory` types its action door that way: this package
 * does not depend on `@flow-state-dev/engine`, and growing a dependency on it
 * to name one method would invert the layering for a type.
 */
export interface HiredRosterStores {
  resourceState: {
    /**
     * Every live state entry in a scope whose key starts with `keyPrefix`.
     * The engine's `ResourceStateStore.getByPrefix`.
     */
    getByPrefix(
      scopeType: string,
      scopeId: string,
      keyPrefix: string
    ): Promise<Record<string, { state: Record<string, unknown> }>>;
  };
}

/**
 * Most organizations one boot will reload before it refuses.
 *
 * A bound on the boot rather than a statement about how many organizations an
 * app may have: the reads run per organization, so this is what keeps a
 * roster's growth from turning into a start-up that never concludes. An app
 * past it raises the number deliberately, having decided the boot can afford
 * the reads — which is a decision someone should make on purpose, and is the
 * whole reason this refuses instead of truncating.
 */
export const DEFAULT_MAX_RELOAD_ORGS = 100;

/**
 * How long the whole roster read gets before the boot fails.
 *
 * Bounded rather than merely awaited, and the bound covers the SET rather than
 * each read: a boot that hangs on a dead connection pool is worse for a
 * platform to handle than one that exits, because nothing ever concludes and
 * nothing is ever retried. Ten seconds is long enough for a cold pool to open
 * and short enough that a platform's own start-up budget is not spent waiting.
 */
export const DEFAULT_ROSTER_READ_TIMEOUT_MS = 10_000;

export interface ReloadHiredSeatsOptions {
  /** The runtime's resolved stores — `(await flowstate.getRuntime()).stores`. */
  stores: HiredRosterStores;

  /**
   * Which organizations to reload.
   *
   * Taken rather than discovered, because which organizations an app reloads
   * is the app's policy and not one this package can make for it. There is no
   * org-filtered read path to inherit, so a package that guessed the
   * enumeration would be guessing for every app.
   */
  orgIds: readonly string[];

  /**
   * The flow kinds a stored `flow` may name — the SAME map passed to
   * `hireWorkforce` for the file-declared roster.
   *
   * Passing a different map is how a reloaded seat ends up carrying a
   * different tool catalog from its file-declared neighbours for no stated
   * reason, so export the app's one map and hand it to both.
   */
  kinds?: HireOptions["kinds"];

  /** Most orgs to reload before refusing. @default {@link DEFAULT_MAX_RELOAD_ORGS} */
  maxOrgs?: number;

  /** The whole read's bound. @default {@link DEFAULT_ROSTER_READ_TIMEOUT_MS} */
  timeoutMs?: number;
}

/** What one boot's reload produced, and what it could not. */
export interface HiredRosterReload {
  /**
   * The seats that hired, ordered by address. Register them one at a time and
   * fold any refusal into {@link HiredRosterReload.problems} — see this file's
   * header for why this does not register them itself.
   */
  seats: FlowInstance[];
  /**
   * One named entry per row that did not become a seat, in the same dialect
   * `openInventory` uses. Never thrown, and never empty-by-omission: a skip
   * that reached only a log line is the degradation this is supposed to make
   * honest.
   */
  problems: string[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read each organization's stored roster and hire what it names.
 *
 * @param options `stores` / `orgIds`: where to read and for whom. `kinds`: the
 *   app's kind map. `maxOrgs` / `timeoutMs`: the two bounds.
 * @returns the hired seats and one named problem per row that could not
 *   become one. **The caller registers the seats.**
 * @throws when there are more organizations than the cap, or when the read
 *   does not complete within its bound. Neither returns a partial roster.
 */
export async function reloadHiredSeats(
  options: ReloadHiredSeatsOptions
): Promise<HiredRosterReload> {
  const maxOrgs = options.maxOrgs ?? DEFAULT_MAX_RELOAD_ORGS;
  const orgIds = options.orgIds;

  // Before the first read, so a refused boot has touched nothing. Refusing
  // rather than slicing is the point — see the file header.
  if (orgIds.length > maxOrgs) {
    throw new Error(
      `reloadHiredSeats was given ${orgIds.length} organizations and its cap is ${maxOrgs}. ` +
        `Nothing was loaded: serving the first ${maxOrgs} would be a short roster that looks ` +
        `like the whole one. Raise \`maxOrgs\` deliberately if the boot can afford the reads.`
    );
  }

  // One bound over the WHOLE set rather than one per read. A per-read bound
  // multiplies by the org count, so a roster of fifty organizations could
  // legitimately spend fifty times the budget and still be "within bounds",
  // which is not a bound on the boot at all.
  //
  // The map is created here and FILLED by the read, so the error factory can
  // read it at the moment the bound expires. That is the whole of what makes
  // BR-17's "naming the org and the store" satisfiable: the reads are
  // sequential, so the first org missing from the map when the timer fires is
  // exactly the one the boot is stuck on. A label built before the read
  // starts can only ever name the count. The BOUND is unchanged — it still
  // covers the whole set (D2); only the attribution is new.
  const readsByOrg = new Map<string, Record<string, { state: Record<string, unknown> }>>();
  await withTimeout(
    readEveryOrg(options.stores, orgIds, readsByOrg),
    options.timeoutMs ?? DEFAULT_ROSTER_READ_TIMEOUT_MS,
    "the hired roster read",
    (label, timeoutMs) => new Error(stalledReadMessage(label, timeoutMs, orgIds, readsByOrg))
  );

  const seats: FlowInstance[] = [];
  const problems: string[] = [];

  for (const [orgId, rowsByKey] of readsByOrg) {
    for (const key of Object.keys(rowsByKey).sort()) {
      const stored = rowsByKey[key]!;
      const where = `organization "${orgId}", row "${key}"`;

      const parsed = parseHiredSeatRow(stored.state);
      if ("problem" in parsed) {
        // Left on disk exactly as it is. A boot that repaired a row it did not
        // understand would destroy the evidence of why it did not.
        problems.push(`${where} — ${parsed.problem}`);
        continue;
      }

      // The address is built here, and it THROWS for a cell whose org id is
      // not a legal segment (`DEFAULT_ORG_ID`, where an app with no principal
      // resolver hires) or a seat id carrying the user-owned `~` marker. That
      // is a past write the code cannot address, so it is one named skip like
      // the rest — left uncaught it rejected the whole reload, and every
      // other org's team with it. The owning-org fence inside runs first and
      // is untouched: a row stamped for another org is still refused, never
      // re-bound to a cell it could be addressed under.
      let record: ReturnType<typeof hiredSeatManifest>;
      try {
        record = hiredSeatManifest(orgId, parsed.row);
      } catch (error) {
        problems.push(`${where} — ${messageOf(error)}`);
        continue;
      }
      if ("problem" in record) {
        problems.push(`${where} — ${record.problem}`);
        continue;
      }

      // **One manifest per call, not one call for the roster.** `hireWorkforce`
      // refuses the WHOLE roster when any record is bad — it throws and hires
      // nothing — so a batch call would turn one stale row into a boot with no
      // seats at all. Hiring per row is what turns every one of its refusals
      // (a kind that is gone, settings the kind now rejects, a contract key a
      // past version wrote) into one named skip, which is what the degrade
      // path requires. A kind pre-check would cover only the first of those
      // three; this covers all of them, and reuses the refusal wording that is
      // already the careful one.
      try {
        const hired = hireWorkforce([record.manifest], { kinds: options.kinds });
        seats.push(...hired);
      } catch (error) {
        problems.push(`${where} — ${messageOf(error)}`);
      }
    }
  }

  seats.sort((left, right) => left.id.localeCompare(right.id));
  return { seats, problems };
}

/**
 * Read every organization's roster prefix, into the caller's map.
 *
 * Sequential, and that is what {@link stalledReadMessage} reads it as: at any
 * instant the orgs already in `byOrg` are done and the first one missing is
 * the one in flight. **Parallelise this and that inference stops holding** —
 * the bound would still be correct, but the timeout would name an arbitrary
 * outstanding org rather than the stalled one, so the message would have to
 * name the whole outstanding set instead.
 *
 * Fills the caller's map rather than returning a fresh one for the same
 * reason: an error factory that only runs on timeout has to be able to see
 * how far the read got, and a map that is only handed back on success is
 * never handed back at all in that case.
 *
 * A read that REJECTS is not caught here: a store that will not answer is the
 * fatal half of the rule, and swallowing it would report an organization as
 * having an empty roster when nobody knows what it has.
 */
async function readEveryOrg(
  stores: HiredRosterStores,
  orgIds: readonly string[],
  byOrg: Map<string, Record<string, { state: Record<string, unknown> }>>
): Promise<void> {
  for (const orgId of orgIds) {
    byOrg.set(orgId, await stores.resourceState.getByPrefix("org", orgId, HIRED_ROSTER_PREFIX));
  }
}

/**
 * What the boot says when the roster read runs out of its bound (BR-17).
 *
 * Names the ORG and the STORE CALL, not just a count. A boot that fails with
 * "the read for 40 organizations timed out" tells an operator to go looking
 * through forty tenants; naming the one the read was on, and the exact store
 * method it was waiting on, is the difference between a report and an alert.
 *
 * The `undefined` arm is not defensive padding for an impossible case: the
 * timer and the final read settle in the same tick often enough that every
 * org can be in the map when the factory runs, and a message claiming a
 * stalled org that finished would be worse than one that says it could not
 * attribute the stall.
 */
function stalledReadMessage(
  label: string,
  timeoutMs: number,
  orgIds: readonly string[],
  readSoFar: ReadonlyMap<string, unknown>
): string {
  const stalled = orgIds.find((orgId) => !readSoFar.has(orgId));
  const progress = `${readSoFar.size} of ${orgIds.length} organization${orgIds.length === 1 ? "" : "s"} had answered`;
  const where =
    stalled === undefined
      ? "no organization was still outstanding when the bound expired"
      : `it was reading organization "${stalled}" — ` +
        `stores.resourceState.getByPrefix("org", "${stalled}", "${HIRED_ROSTER_PREFIX}") never answered`;
  return (
    `${label} timed out after ${timeoutMs}ms: ${where}. ` +
    `${progress}. Nothing was loaded — the bound covers the whole set, so a partial ` +
    `roster is never served as the whole one.`
  );
}
