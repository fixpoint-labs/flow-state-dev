/**
 * Which packages one seat holds, and whether their blocks can all be its tools.
 *
 * A seat HOLDS every package in its own `packages/` folder, and the ones its
 * `packages:` line takes by name from its team's library or, failing that, the
 * org's. Reach is not holding: a library package no line names reaches nobody,
 * which is what lets a team keep a package that only some of its seats want.
 *
 * The hire calls both functions here per seat and refuses on any problem, so
 * every problem is a start-time refusal naming the seat and the packages in
 * play. Nothing here reads a file: the text arrives on the seat's record from
 * the loader, and the blocks on the generated `packageBlocks` map.
 */

import type { BlockDefinition } from "@flow-state-dev/core";
import {
  PACKAGES_KEY,
  oneNameMessage,
  packageResourceMessage,
  type PackageManifest
} from "./manifest";

/** One package a seat holds, with the blocks its address carries on the generated map. */
export interface HeldPackage {
  manifest: PackageManifest;
  /** Block name to block, in name order. Empty for an instructions-only package. */
  blocks: Record<string, BlockDefinition<any, any>>;
}

/** What {@link resolveHeldPackages} decided. */
export interface HeldPackages {
  held: HeldPackage[];
  problems: string[];
}

/**
 * The packages one seat holds: its own folder's, then the ones its
 * `packages:` line names, nearest library first.
 *
 * @param seatId The seat's id, for the folders a refusal names. Its
 *   second-to-last segment is the team (`<team>.<worker>`, or
 *   `<org>.<team>.<worker>` for a hired seat).
 * @param declared The seat's `packages:` value as written, or `undefined` when
 *   the file wrote no such line.
 * @param reach The packages in the seat's reach, as the loader joined them.
 * @param packageBlocks The generated map, keyed by package address.
 */
export function resolveHeldPackages(
  seatId: string,
  declared: unknown,
  reach: readonly PackageManifest[] | undefined,
  packageBlocks: Record<string, Record<string, BlockDefinition<any, any>>>
): HeldPackages {
  const available = reach ?? [];
  const own = available.filter((candidate) => candidate.level === "worker");
  const chosen: PackageManifest[] = [...own];
  const problems: string[] = [];
  const segments = seatId.split(".");
  const team = segments[segments.length - 2] ?? "";

  if (declared !== undefined) {
    if (!Array.isArray(declared) || declared.some((name) => typeof name !== "string")) {
      problems.push(
        `declares \`${PACKAGES_KEY}:\` as ${JSON.stringify(declared)}. It takes a list of package ` +
          `names from the team's or the org's \`${PACKAGES_KEY}/\` folder — \`${PACKAGES_KEY}: [escalation]\`.`
      );
      return { held: [], problems };
    }

    for (const name of new Set(declared as string[])) {
      const library =
        available.find((candidate) => candidate.level === "team" && candidate.name === name) ??
        available.find((candidate) => candidate.level === "org" && candidate.name === name);
      const mine = own.find((candidate) => candidate.name === name);

      if (mine !== undefined && library !== undefined) {
        problems.push(
          `names package "${name}" in \`${PACKAGES_KEY}:\`, and both its own folder ` +
            `("${mine.path}") and a library ("${library.path}") offer one by that name. One name ` +
            `is one package — rename one of them.`
        );
        continue;
      }
      // Its own package is held already; naming it too changes nothing.
      if (mine !== undefined) continue;
      if (library === undefined) {
        problems.push(
          `names package "${name}" in \`${PACKAGES_KEY}:\`, and no library in its reach offers it. ` +
            `Looked in "teams/${team}/${PACKAGES_KEY}/${name}" and "org/${PACKAGES_KEY}/${name}".`
        );
        continue;
      }
      chosen.push(library);
    }
  }

  const held = chosen.map((manifest) => {
    const onMap = packageBlocks[manifest.path] ?? {};
    const blocks: Record<string, BlockDefinition<any, any>> = {};
    for (const key of Object.keys(onMap).sort()) blocks[key] = onMap[key]!;
    return { manifest, blocks };
  });

  // A package in the seat's own folder is always held, so blocks generated at
  // an address under that folder that no held package accounts for mean the
  // loader refused that package's PACKAGE.md (or a hand-built record left it
  // off). Hiring on would start this seat short a package its folder holds —
  // refused, as a bad block in its own `blocks/` folder is.
  const ownFolder = `teams/${team}/workers/${segments[segments.length - 1] ?? ""}/${PACKAGES_KEY}/`;
  const heldPaths = new Set(chosen.map((manifest) => manifest.path));
  for (const address of Object.keys(packageBlocks).sort()) {
    if (!address.startsWith(ownFolder) || address.slice(ownFolder.length).includes("/")) continue;
    if (heldPaths.has(address)) continue;
    problems.push(
      `has package blocks generated at "${address}", its own folder, but does not hold that ` +
        `package — its \`PACKAGE.md\` was refused (see \`readWorkforce\`'s \`packageErrors\`) or ` +
        `the record was built without it. A package in a worker's own folder is always held: fix ` +
        `the package, or remove the folder and re-run \`fsdev gen\`.`
    );
  }
  return { held, problems };
}

/**
 * Why a seat's held packages' blocks cannot all be its tools — every reason,
 * or an empty list.
 *
 * Checked whether or not the seat names the block, for the reason a seat's own
 * registry is: holding a package promises its blocks are callable, and a
 * promise the framework cannot keep is broken whether or not this seat happens
 * to use it today.
 *
 * - A block registered under a key its own `name` does not match.
 * - A block that declares a store.
 * - A block whose name the seat's own or team `blocks/` folder also registers.
 * - A block whose name another held package also carries.
 *
 * Nothing is shadowed: each is refused naming both sources.
 *
 * @param held What {@link resolveHeldPackages} returned.
 * @param registry The seat's own registry (its folder's and its team's blocks).
 */
export function heldPackageProblems(
  held: readonly HeldPackage[],
  registry: Record<string, BlockDefinition<any, any>>
): string[] {
  const problems: string[] = [];
  /** Block name → the package that carried it first. */
  const claimed = new Map<string, string>();

  for (const { manifest, blocks } of held) {
    for (const [key, block] of Object.entries(blocks)) {
      const blockName = (block as { name?: unknown }).name;
      if (typeof blockName === "string" && blockName !== key) {
        problems.push(oneNameMessage(key, blockName, `Package "${manifest.path}"`));
      }
      const declared = (block as { declaredResources?: Record<string, unknown> }).declaredResources;
      const accessors = declared === undefined ? [] : Object.keys(declared);
      if (accessors.length > 0) problems.push(packageResourceMessage(manifest.path, key, accessors));

      if (Object.hasOwn(registry, key)) {
        problems.push(
          `holds package "${manifest.path}", whose block "${key}" has the same name as a block its ` +
            `own or its team's \`blocks/\` folder registers. One name is one tool, and neither is ` +
            `quietly hidden — rename one of them.`
        );
      }
      const first = claimed.get(key);
      if (first !== undefined) {
        problems.push(
          `holds packages "${first}" and "${manifest.path}", which both carry a block named ` +
            `"${key}". One name is one tool — rename one of them.`
        );
      } else {
        claimed.set(key, manifest.path);
      }
    }
  }
  return problems;
}
