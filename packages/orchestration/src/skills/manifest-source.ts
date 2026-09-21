/**
 * The skills manifest source (FIX-817) — the skills domain's projection into
 * the discovery door.
 *
 * Built over `listEnabledSkills`, which is unchanged and still the reader. What
 * this adds is the same two filters the ambient catalog already applies, so the
 * door and `loadSkill` agree on what exists:
 *
 *   - **`disable-model-invocation`** is dropped by `listEnabledSkills` itself.
 *   - **Mode and `allowed`** are dropped here, exactly as
 *     `buildLoadCatalogContext` drops them: the load tool refuses a
 *     fork/pattern skill and refuses a name outside the binding's `allowed`
 *     set, so advertising either would invite a call that cannot succeed. A
 *     catalog that lies is worse than one that is short.
 *
 * Seeding runs first, on the same terms the ambient catalog seeds on. A source
 * that skipped it would report an empty catalog on the turn before the first
 * render seeds it, and the two surfaces would disagree about the same library
 * for one turn — which is the failure this door exists to remove.
 *
 * A missing collection THROWS rather than returning nothing. An absent domain
 * is an ordinary state and the registry already says so by carrying no source;
 * a registered source pointed at a collection this scope does not hold is a
 * wiring mistake, and the door degrades it to a `problem` on this domain while
 * every other domain still answers.
 *
 * ## The seam, stated plainly
 *
 * `collectionKey` and `allowed` are values the BINDING already holds, and the
 * caller repeats them here. Nothing checks that the two agree, so drift on
 * either silently reinstates the failure above: a source with a stale
 * `allowed` advertises a skill the loader refuses, and one with the wrong
 * collection key throws on every read.
 *
 * It is a seam rather than a wiring mistake because a source is registered on
 * a SCOPE and a binding is made per GENERATOR — one scope can carry several
 * bindings over one library, and there is no single `allowed` for the source
 * to inherit. Closing it means deciding which binding a scope's skills domain
 * speaks for, which is a question above this function. Until then the rule is
 * the one line: pass the same array the binding was given.
 */

import type { BlockManifestSource, ManifestEntry } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { resolveResourceCollection } from "../tasks";
import { listEnabledSkills } from "./internal/list-enabled-skills";
import { resolveInitialSkills, type InitialSkillsSource } from "./initial-skills";
import { ensureSeeded } from "./seeding";

export interface SkillsManifestSourceOptions {
  /** Resource registry key for the skills collection. Default `"skills"`. */
  collectionKey?: string;
  /**
   * The names the binding's load tool will accept, when it declares a set.
   *
   * Pass the SAME array the binding was given (`skills.with({ allowed })`).
   * Omitted, every enabled inline skill is listed, which is what an
   * `allowed`-less binding accepts.
   */
  allowed?: readonly string[];
  /** The library's bundled defaults, so a first read seeds what a first render would. */
  initialSkills?: InitialSkillsSource;
}

/**
 * The skills domain, projected on demand from `listEnabledSkills`.
 *
 * @param options The collection key, and the binding's `allowed` set and
 *   bundled defaults when it has them.
 * @returns A source the scope's manifest registry can carry.
 */
export function skillsManifestSource(
  options: SkillsManifestSourceOptions = {},
): BlockManifestSource {
  const collectionKey = options.collectionKey ?? "skills";
  const allowedSet = options.allowed ? new Set(options.allowed) : undefined;

  return {
    domain: "skills",
    origin: `skillsManifestSource("${collectionKey}")`,
    entries: async (ctx: BlockContext): Promise<ManifestEntry[]> => {
      const collection = resolveResourceCollection(ctx, collectionKey);
      if (!collection) {
        throw new Error(
          `Skills collection "${collectionKey}" is not registered on ctx.resources. ` +
            `Register the skills library on this block, or drop the skills source from ` +
            `this scope's manifest registry.`,
        );
      }
      try {
        await ensureSeeded(collection, resolveInitialSkills(options.initialSkills, ctx));
      } catch {
        // Seeding failure is already logged where it happens, and a catalog
        // that seeded partially still answers for what it holds.
      }

      const entries: ManifestEntry[] = [];
      for (const skill of await listEnabledSkills(collection)) {
        if (skill.mode !== "inline") continue;
        if (allowedSet && !allowedSet.has(skill.name)) continue;
        entries.push({
          id: skill.name,
          kind: "skill",
          // `listEnabledSkills` joins `description` and `whenToUse` with a
          // newline. The purpose line is what the model chooses on, so the
          // join is kept whole rather than trimmed back to the first half.
          purpose: skill.description.trim() || `Skill "${skill.name}".`,
          // Hedged rather than flat, because this source is installable on a
          // scope whose binding never turned `dynamicActivation` on — in which
          // case `loadSkill` does not exist and a flat instruction would be
          // the lie this whole module is about not telling. The source cannot
          // see the binding (see the seam above), so it names the tool and
          // leaves the model to find it on its own tool list.
          contract:
            `If you have a \`loadSkill\` tool, load it with ` +
            `loadSkill({ name: "${skill.name}" }).`,
        });
      }
      return entries;
    },
  };
}
