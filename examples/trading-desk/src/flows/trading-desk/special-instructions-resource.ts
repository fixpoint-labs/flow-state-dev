/**
 * `defineResource` for the user-scoped special-instructions surface. Kept in
 * its own file so importing the resource (which pulls in
 * `@flow-state-dev/core`'s root barrel and its Node-only model resolvers)
 * never reaches client bundles. Pure schema/types/formatters live in the
 * sibling `./special-instructions` module, which is import-safe in the
 * browser.
 *
 * Storage: user-scope with `flowIsolation: true`, so the record lives under
 * `{userId}:trading-desk` and never bleeds into other flows that share the
 * same user identity.
 */
import { defineResource } from "@flow-state-dev/core";
import {
  EMPTY_INSTRUCTIONS,
  specialInstructionsStateSchema,
} from "./special-instructions";

/**
 * The user-scoped, flow-isolated singleton resource that backs the settings
 * surface. `client.expose` opts every field into the session snapshot so the
 * settings dialog can read persisted state via `useResource`.
 */
export const specialInstructionsResource = defineResource({
  scope: "user",
  flowIsolation: true,
  ref: "tradingDeskSpecialInstructions",
  stateSchema: specialInstructionsStateSchema,
  default: EMPTY_INSTRUCTIONS,
  writable: true,
  client: {
    expose: ["global", "phase1", "phase2", "phase3", "phase4", "phase5"],
  },
});
