/**
 * What a TypeScript file in a `resources/` folder is allowed to be.
 *
 * These types are the whole of how a discovered module's *value* is checked.
 * Neither walk opens a module — discovery is a build step that renders static
 * imports, and opening one would answer for the source rather than for what the
 * app's bundler resolves — so the generated map is typed instead, and the app's
 * own typecheck reads every file it lists, naming the one that does not fit.
 *
 * Isomorphic: types only, no `node:fs`. They sit on the package root because
 * the generated module imports them the way it already imports `HireOptions`.
 */

import type { DeclaredResources, DefinedCapability } from "@flow-state-dev/core";

/**
 * One entry of a flow's resource map — a resource or a collection.
 *
 * Read off `DeclaredResources` rather than imported: core names the map on its
 * public root and its element type only internally, and widening core's surface
 * to spell a type that is already derivable would be a second name for one
 * thing.
 */
type DeclaredResourceEntry = DeclaredResources[string];

/**
 * A module in the organisation's or a team's `resources/` folder: a capability
 * the kind installs, or a resource that merges into the one resource map.
 *
 * A module exporting neither fails here, in the app's own typecheck, naming its
 * file — which is where a check on an export's shape belongs, since nothing in
 * the walk ever looks inside one.
 */
export type ResourceModuleExport = DefinedCapability | DeclaredResourceEntry;

/**
 * A module in a single worker's OWN `resources/` folder: a resource, and never
 * a capability.
 *
 * Every seat of a kind shares that kind's capabilities, so a capability
 * installed from one worker's folder would quietly change every other seat of
 * that kind. Giving one seat behaviour nobody else has needs a per-seat
 * install, which the convention rules out on purpose — so the honest answer is
 * to refuse the file rather than to install it kind-wide or skip it in silence.
 *
 * Named rather than inlined so the generated map says at its own call site
 * which entries are held to it. The name is not what the compiler prints — TS
 * resolves an alias of a union down to the union's own name — so the sentence
 * an author needs is emitted as a comment above the map instead, on the line
 * their editor puts the error next to.
 */
export type WorkerResourceModuleExport = DeclaredResourceEntry;

/**
 * The generated `resourceModules` map: one entry per discovered module, keyed
 * by the ref a document of that name in that folder would have.
 */
export type ResourceModules = Record<string, ResourceModuleExport>;
