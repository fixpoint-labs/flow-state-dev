/**
 * Where the `fsd` profile's (`fsd.fsdev.config.mts`) coding runs work: its
 * repository's remote and the checkout mapping it hands `openLab`. A leaf, so
 * a check can read the mapping without opening the profile's Lab.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectCheckout } from "@flow-state-dev/workforce";
import { LAB_ORG_ID } from "./host.mts";

/** This repository's remote: the one both of the profile's projects name. */
export const REPOSITORY = "https://github.com/fixpoint-labs/flow-state-dev.git";

/** The root of the checkout this file sits in: `packages/shift-manager/teams/devteam/` is four levels down. */
export const CHECKOUT = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

/**
 * Where the two projects' runs work: worktrees of {@link CHECKOUT}, each on a
 * branch cut from the newer of local `main` and its freshly fetched upstream
 * (the workspace host's rule for a listed checkout). Only the two shared projects
 * of the Lab's organization are named, so a project a user makes on the same
 * remote is not mapped, and is refused.
 */
export const CHECKOUTS: readonly ProjectCheckout[] = [
  {
    remote: REPOSITORY,
    checkout: CHECKOUT,
    projects: [
      { orgId: LAB_ORG_ID, id: "fsd" },
      { orgId: LAB_ORG_ID, id: "shift-manager" },
    ],
    baseRef: "main",
  },
];
