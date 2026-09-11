/**
 * `@flow-state-dev/workforce` — Agent registry and materialization.
 *
 * Provides the first-class Agent primitive: a named, reusable participant
 * composed of a Persona (its identity), Skills, a model, and tools. The
 * package supplies `defineAgent`, `createAgentRegistry`, `materializeAgent`,
 * `agentBlock`, `definePersona`, and `createWorkforceCapability`.
 *
 * It also supplies the seat factory — `hireWorkforce`, which turns worker
 * records into one configured, addressable flow copy each — and declares
 * `WorkerManifest`, the record those workers are made of, whether described in
 * files or written by hand. Reading that description off disk is the `./loader`
 * subpath's job, kept out of the root so importing this package does not pull a
 * consumer onto `node:fs`.
 *
 * The same split covers file-declared documents: `ResourceDoc` is the record,
 * `./loader` reads it off disk, and `resourcesFromDocs` here turns records into
 * the resource map an app spreads into its flow.
 */

export { defineAgent } from "./define-agent";
export { createAgentRegistry } from "./agent-registry";
export { materializeAgent } from "./materialize-agent";
export { AgentCapabilityError, AGENT_CAPABILITY_UNRESOLVED } from "./errors";
export { agentBlock, type AgentBlockOptions } from "./agent-block";
export { definePersona, type PersonaResourceConfig, type PersonaCollectionConfig } from "./define-persona";
export { createWorkforceCapability, type WorkforceCapabilityOptions } from "./workforce-capability";
export { hireWorkforce, type HireOptions } from "./hire";
export { resourcesFromDocs } from "./resources-from-docs";
export type { WorkerManifest, ResourceDoc } from "./manifest";
