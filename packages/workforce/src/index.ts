/**
 * `@flow-state-dev/workforce` — the seat factory and its persona helpers.
 *
 * The package supplies `hireWorkforce`, which turns worker records into one
 * configured, addressable flow copy each, and declares `WorkerManifest`, the
 * record those workers are made of, whether described in files or written by
 * hand. Reading that description off disk is the `./loader` subpath's job, kept
 * out of the root so importing this package does not pull a consumer onto
 * `node:fs`.
 *
 * A worker is a flow kind plus its instructions. There is no Agent factory
 * here: `defineAgent`, `createAgentRegistry`, `materializeAgent` and
 * `agentBlock` were removed.
 */

export { definePersona, type PersonaResourceConfig, type PersonaCollectionConfig } from "./define-persona";
export { createWorkforceCapability, type WorkforceCapabilityOptions } from "./workforce-capability";
export { hireWorkforce, type HireOptions } from "./hire";
export type { WorkerManifest } from "./manifest";
