/**
 * Artifacts concern — public surface.
 *
 * Artifacts is a capability (`artifactsCapability`) with a small concern behind
 * it: a session resource, read/write tools, an inventory context formatter, and
 * the `saveArtifact` action (`updateArtifact`). Consumers import from here, not
 * the individual modules.
 */
export { artifactsCapability } from "./capability";
export {
  artifactStateSchema,
  artifactsCollection,
  artifactResources,
} from "./resource";
export {
  readArtifact,
  writeArtifact,
  updateArtifact,
  readArtifactInputSchema,
  readArtifactOutputSchema,
  updateArtifactInputSchema,
  updateArtifactOutputSchema,
} from "./tools";
export { artifactListContext } from "./context";
