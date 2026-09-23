/**
 * Compile-time half of Door B: what a discovered module is allowed to export,
 * and where the two halves it splits into are allowed to go.
 *
 * Neither walk opens a module, so nothing at runtime can tell a capability from
 * a resource, or either from a file that exports neither. The generated map is
 * typed instead, and these are the assignments an app's own typecheck makes
 * when it compiles that map — the check that names a bad file is *here*, not in
 * a walk, which is why it is pinned here too.
 *
 * Vitest strips types rather than checking them, and this package's `src`
 * typecheck does not include `test/`. So `tsconfig.test-d.json` compiles every
 * `.test-d.ts` file here, and the `typecheck` script runs it after the `src`
 * pass. Each `@ts-expect-error` below is its own negative control: widen the
 * type it guards and the suppression has nothing to suppress, which is itself
 * an error (TS2578), so `pnpm typecheck` goes red either way.
 *
 * Imported through the package root rather than the module, because the root is
 * where a generated file reaches these names.
 */
import { defineCapability, defineResource } from "@flow-state-dev/core";
import type { DeclaredResources, UsesSlot } from "@flow-state-dev/core";
import { z } from "zod";
import { resourcesFromDocs, splitResourceModules } from "../src";
import type { ResourceModuleExport, WorkerResourceModuleExport } from "../src";

/** A capability, written the way an author always writes one. */
const research = defineCapability({
  name: "research",
  presets: { briefing: { context: [] }, default: [] },
});

/** A resource, written the way an author always writes one. */
const handbook = defineResource({
  ref: "handbook",
  scope: "org",
  stateSchema: z.object({}).passthrough(),
  default: {},
});

/** Control — the organisation's and a team's folders take both. */
export const capabilityAtTeamLevel: ResourceModuleExport = research;
export const resourceAtTeamLevel: ResourceModuleExport = handbook;

/** Control — a worker's own folder takes a resource, the same as a document there. */
export const resourceAtWorkerRoot: WorkerResourceModuleExport = handbook;

/**
 * The refusal (BR-21). Every seat of a kind shares that kind's capabilities, so
 * one installed from a single worker's folder would quietly change every other
 * seat — and the name the compiler prints beside the file is the only place
 * that refusal can be said in words.
 */
// @ts-expect-error a capability may not sit in one worker's own resources/ folder.
export const capabilityAtWorkerRoot: WorkerResourceModuleExport = research;

/**
 * A module exporting neither (BR-9). This is the whole reason the rendered map
 * carries a type: the walk never opens the file, so the app's own typecheck is
 * what reads it and names it.
 */
// @ts-expect-error an object that is neither a capability nor a resource.
export const exportsNeither: ResourceModuleExport = { hello: "world" };

// @ts-expect-error a module whose default export is a bare value.
export const exportsAString: ResourceModuleExport = "not a declaration";

/**
 * The install half's promise, which is a type promise as much as a runtime one:
 * what `splitResourceModules` hands back has to drop into the two slots an app
 * already has, with no cast at the call site.
 *
 * Pinned here because vitest strips types — the runtime specs next door would
 * pass just as well against a return type nobody could assign anywhere.
 */
const halves = splitResourceModules({ "teams/engineering/research": research });

/** The capabilities go to a block's `uses` slot, which is how they reach a worker kind. */
export const usesSlot: UsesSlot = halves.capabilities;

/** The resources merge into the flow's own map, beside what the documents filled. */
export const flowResources: DeclaredResources = {
  ...resourcesFromDocs([]),
  ...halves.resources,
};
