/**
 * `defineResource` for the user-scoped special-instructions surface. Kept in
 * its own file so importing the resource (which pulls in
 * `@flow-state-dev/core`'s root barrel and its Node-only model resolvers)
 * never reaches client bundles. Pure schema/types/formatters live in the
 * flow-root `../special-instructions` module, which is import-safe in the
 * browser.
 *
 * Storage: user-scope with `flowIsolation: false`, so the record lives under
 * bare `{userId}`, shared across flows for the user. This is required so that
 * `effectiveScopeIsolation` is consistent across all user-scoped resources on
 * the same flow (see FIX-735) — if any user-scoped resource keeps isolation on,
 * the whole flow's user record would namespace to `{userId}:{flowKind}` and the
 * report flow's cross-flow reads would resolve to the wrong key.
 */
import { defineResource } from "@flow-state-dev/core";
import {
  EMPTY_INSTRUCTIONS,
  specialInstructionsStateSchema,
} from "../special-instructions";

/**
 * The user-scoped, flow-isolated singleton resource that backs the settings
 * surface. `client.expose` opts every field into the session snapshot so the
 * settings dialog can read persisted state via `useResource`.
 */
export const specialInstructionsResource = defineResource({
  scope: "user",
  flowIsolation: false,
  ref: "tradingDeskSpecialInstructions",
  stateSchema: specialInstructionsStateSchema,
  default: EMPTY_INSTRUCTIONS,
  writable: true,
  client: {
    expose: ["global", "phase1", "phase2", "phase3", "phase4", "phase5"],
  },
});
