/**
 * A `.tap()`-able handler that seeds a skills collection's bundled defaults.
 *
 * The up-front matcher (`createSkillActivator`) runs before the generator, so
 * it can't rely on the binding reader's lazy seeding — on a fresh collection
 * the slash/keyword/classifier tiers would see an empty catalog on turn 1 and
 * match nothing. Prepending this step seeds the catalog before the first tier
 * reads it. Idempotent (seeding is memoized per collection ref).
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { resolveResourceCollection } from "../tasks";
import {
  resolveInitialSkills,
  type InitialSkillsSource,
} from "./initial-skills";
import { ensureSeeded } from "./seeding";

const inputSchema = z.object({ message: z.string() }).passthrough();

export interface CatalogSeedStepOptions {
  collectionKey: string;
  /** Bundled defaults, or a resolver read against this turn's own context. */
  initialSkills?: InitialSkillsSource;
}

/** Build the catalog-seed handler for a collection + bundled defaults. */
export function createCatalogSeedStep(opts: CatalogSeedStepOptions) {
  return handler({
    name: "seed-skills-catalog",
    inputSchema,
    outputSchema: z.object({ seeded: z.boolean() }),
    execute: async (_input, ctx) => {
      const collection = resolveResourceCollection(ctx, opts.collectionKey);
      if (collection) {
        try {
          await ensureSeeded(collection, resolveInitialSkills(opts.initialSkills, ctx));
        } catch {
          // Seeding failure is already logged inside ensureSeeded; the tiers
          // fall through against whatever the collection contains.
        }
      }
      return { seeded: true };
    },
  });
}
