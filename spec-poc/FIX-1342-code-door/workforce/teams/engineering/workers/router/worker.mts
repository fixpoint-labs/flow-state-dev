/**
 * A worker whose shape a document cannot express — the case FIX-1342 is about.
 *
 * It is an ordinary `WorkerManifest`: the same record the loader produces for a
 * `WORKER.md`, written by hand instead of parsed. The part a document could not
 * have carried is `route` — a live function, not a string. YAML has no way to
 * write one, so this seat could never have been a `WORKER.md`.
 *
 * Nothing here is framework surface. The app imports this file itself, with an
 * ordinary static `import`, and passes the record to `hireWorkforce` beside the
 * ones that came off disk.
 */
import type { WorkerManifest } from "../../../../../../../packages/workforce/src/manifest";

/** Held out from the check: recomputed at call time, so it cannot be faked by a literal. */
const DESKS = ["billing", "returns", "abuse"] as const;

/**
 * Exported by NAME, not as a default. The POC found that a `export default`
 * from this file arrives as `{ default: { default: … } }` when the importing
 * app is CJS and bare when it is ESM — so "the default export" is not one
 * shape. A named export survives both unchanged.
 */
export const routerWorker: WorkerManifest = {
  id: "engineering.router",
  declared: {
    description: "Sends each request to the desk that owns it.",
    flow: "router",
    // The thing a WORKER.md cannot say. A function, held live on the record.
    route: (subject: string): string =>
      DESKS.find((desk) => subject.toLowerCase().includes(desk)) ?? "billing",
  },
  body: "You route requests. You never answer them yourself. Marker: KESTREL-7781",
};

// Kept as well, to show the difference: this is the one that gets wrapped.
export default routerWorker;
