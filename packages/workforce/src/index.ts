/**
 * `@flow-state-dev/workforce` — Agent registry and materialization.
 *
 * Provides the first-class Agent primitive: a named, reusable participant
 * composed of a Persona (its identity), Skills, a model, and tools. The
 * package supplies `defineAgent`, `createAgentRegistry`, `materializeAgent`,
 * `agentBlock`, `definePersona`, and `createWorkforceCapability`.
 *
 * It also declares `WorkerManifest`, the record a workforce described in files
 * or written by hand is made of. Reading that description off disk is the
 * `./loader` subpath's job — kept out of the root so importing this package
 * does not pull a consumer onto `node:fs`.
 */

export { defineAgent } from "./define-agent";
export { createAgentRegistry } from "./agent-registry";
export { materializeAgent } from "./materialize-agent";
export { AgentCapabilityError, AGENT_CAPABILITY_UNRESOLVED } from "./errors";
export { agentBlock, type AgentBlockOptions } from "./agent-block";
export { definePersona, type PersonaResourceConfig, type PersonaCollectionConfig } from "./define-persona";
export { createWorkforceCapability, type WorkforceCapabilityOptions } from "./workforce-capability";
export type { WorkerManifest } from "./manifest";
