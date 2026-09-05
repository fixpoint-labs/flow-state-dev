/**
 * Pre-LAB-152 names for the handle envelope both entry points build on.
 *
 * The envelope is no longer defined in this package: it is the framework's
 * neutral harness envelope (`@flow-state-dev/core`), which a second harness —
 * and a manager that drives either — can depend on without installing this
 * package. Import the neutral shapes from there. These aliases keep the
 * package root's published names working for one release.
 */
import { harnessRunEnvelopeSchema } from "@flow-state-dev/core";
import type {
  HarnessRunEnvelope,
  HarnessRunStatus,
  HarnessSource,
} from "@flow-state-dev/core/types";

/** @deprecated Use `harnessRunEnvelopeSchema` from `@flow-state-dev/core`. */
export const remoteAgentTaskHandleSchema = harnessRunEnvelopeSchema;

/** @deprecated Use `HarnessRunEnvelope` from `@flow-state-dev/core/types`. */
export type RemoteAgentTaskHandle = HarnessRunEnvelope;

/**
 * @deprecated Use `HarnessSource` from `@flow-state-dev/core/types`. Widened
 * from an enum of this package's two doors to any harness's `<package>/<door>`
 * name.
 */
export type RemoteAgentSource = HarnessSource;

/** @deprecated Use `HarnessRunStatus` from `@flow-state-dev/core/types`. */
export type RemoteAgentStatus = HarnessRunStatus;
