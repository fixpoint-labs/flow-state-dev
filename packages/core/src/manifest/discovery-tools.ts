/**
 * The discovery door (FIX-817) — one scoped, on-demand tool over whatever
 * manifest sources a scope carries.
 *
 * An agent deciding *who does this* calls `discover` and gets back a short
 * list of what is in scope for it right now: each entry an id, what kind of
 * thing it is, and a line saying what it is for. Nothing is spent until it
 * asks, and what comes back is read at the moment it asks.
 *
 * Three properties are the whole point:
 *
 *   - **Scoped at the registry, not filtered here.** The `domain` argument is
 *     model-supplied. This tool can only reach sources its registry holds, so
 *     naming something out of scope returns nothing to filter (BP-031).
 *   - **Nothing fatal, except cancellation.** An unknown domain, an empty
 *     domain and a reader that throws all degrade to an answer the model can
 *     act on. A planner that loses its turn because one collection was
 *     misconfigured is worse than one that plans with three domains out of
 *     four. Cancellation is the exception: it is not a domain's problem but
 *     the caller's, so it propagates instead of being reported as one.
 *   - **Thin by default.** `detail: "full"` adds each entry's `contract`;
 *     every other call pays for the purpose line and no more.
 */

import { z } from "zod";
import { MANIFEST_DOMAINS, isManifestDomain } from "@flow-state-dev/contracts";
import type { ManifestDomain, ManifestEntry } from "@flow-state-dev/contracts";
import { isAbortLike } from "../errors/abort";
import { toError } from "../helpers/to-error";
import { handler } from "../blocks/handler";
import type { BlockContext } from "../types/block";
import type { ManifestRegistry } from "./registry";

/**
 * One entry as the door returns it, checked against `ManifestEntry` itself.
 * `contracts` is zero-dependency and carries no zod, so the record and its
 * wire schema are necessarily two declarations; `satisfies` is what keeps them
 * one shape — add a required field there and this fails to compile rather than
 * quietly never reaching a caller.
 */
const manifestEntrySchema = z.object({
  id: z.string(),
  kind: z.string(),
  purpose: z.string(),
  contract: z.string().optional(),
}) satisfies z.ZodType<ManifestEntry>;

/** One domain's answer: its entries, or the problem that stopped it answering. */
const domainResultSchema = z.object({
  domain: z.string(),
  entries: z.array(manifestEntrySchema),
  problem: z.string().optional(),
});

/**
 * Read one domain. A source that throws reports here and leaves every other
 * domain answering — one broken reader does not make the door useless.
 *
 * Entries come back sorted by id so two identical scopes read identically,
 * whatever order a reader happened to return.
 */
async function readDomain(
  registry: ManifestRegistry,
  domain: ManifestDomain,
  detail: "thin" | "full",
  ctx: BlockContext,
): Promise<z.infer<typeof domainResultSchema>> {
  const source = registry.source(domain);
  // Absent, not empty-with-a-reason: a scope that carries no channels is an
  // ordinary state and the model should read it as "nothing here".
  if (source === undefined) return { domain, entries: [] };

  let entries: ManifestEntry[];
  try {
    entries = await source.entries(ctx);
  } catch (err: unknown) {
    // Cancellation is the caller going away, not this domain being broken.
    // Degrading it to a `problem` would hand the model a half-catalog that
    // reads as complete, and would let the caller's loop go on paying for the
    // remaining domains' reads after nobody is waiting for them.
    if (isAbortLike(err) && ctx.signal?.aborted === true) throw err;
    return { domain, entries: [], problem: toError(err).message };
  }

  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  return {
    domain,
    entries: sorted.map((entry) =>
      detail === "full" && entry.contract !== undefined
        ? { id: entry.id, kind: entry.kind, purpose: entry.purpose, contract: entry.contract }
        : { id: entry.id, kind: entry.kind, purpose: entry.purpose },
    ),
  };
}

/**
 * Build the discovery door over the sources a scope carries.
 *
 * Returns one tool:
 *
 * - `discover({ domain?, detail? })` — with no domain, every domain the scope
 *   carries; with one, just that domain. A domain name that is not one of the
 *   four returns the known names rather than throwing, so the next call can
 *   succeed.
 *
 * One tool taking a domain, rather than a `listSeats` / `listChannels` family:
 * it keeps the shared shape real in the surface a model sees, and `detail`
 * turns "how much does an entry say" into a per-call choice. Going from one
 * tool to four later is additive; going from four to one would break prompts.
 */
export function discoveryTools(registry: ManifestRegistry) {
  const discover = handler({
    name: "discover",
    description:
      "List what is in scope for you right now — the seats you can hand work to, the channels they share, the skills you can load, and the resources you can read. Omit `domain` for everything in scope.",
    inputSchema: z.object({
      domain: z
        .string()
        .nullable()
        .default(null)
        .describe(
          `One of: ${MANIFEST_DOMAINS.join(", ")}. Null returns every domain in scope.`,
        ),
      detail: z
        .enum(["thin", "full"])
        .default("thin")
        .describe("'full' adds each entry's contract hint. Default 'thin'."),
    }),
    outputSchema: z.object({
      domains: z.array(domainResultSchema),
      problem: z.string().optional(),
    }),
    execute: async (input, ctx) => {
      if (input.domain !== null && !isManifestDomain(input.domain)) {
        return {
          domains: [],
          problem:
            `Unknown domain "${input.domain}". Known domains: ${MANIFEST_DOMAINS.join(", ")}. ` +
            `Call again with one of those, or omit \`domain\` for everything in scope.`,
        };
      }

      const wanted: ManifestDomain[] =
        input.domain === null ? registry.domains() : [input.domain as ManifestDomain];

      const domains = [];
      for (const domain of wanted) {
        // Stop between domains rather than starting another reader's
        // (potentially expensive) collection reads for a caller that is gone.
        // A source that never looks at `ctx.signal` cannot stop itself.
        ctx.signal?.throwIfAborted();
        domains.push(await readDomain(registry, domain, input.detail, ctx));
      }
      return { domains };
    },
  });

  return { discover };
}
