/**
 * What the app works on and with: the host's `lab-context` view (the working
 * folder, the model, the default harness, each worker's delegates) and the
 * harness kit's readiness view, each read by scope with no session.
 */
import { viewRef, type Client } from "@flow-state-dev/client";
import { harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import type { AppContextView } from "../../host.mts";
import type { HarnessReadinessChipRow } from "../components/flow-state/harness-readiness";

/** One coding harness's readiness, as harness-manager's readiness view answers it. */
export type AppHarness = HarnessReadinessChipRow;

// FIX-2624.
/** The flow the harness kit serves its readiness view on. */
const HARNESSES_FLOW = "harnesses";
/** The harness kit's readiness view, read by scope with no session. */
const READINESS_VIEW = harnessReadinessViewRef(HARNESSES_FLOW);
/** The host's lab-context view (`host.mts`), read by scope with no session. */
const LAB_CONTEXT_VIEW = viewRef<AppContextView>("lab-context", "context");

/** What the lab works on and with, from its `lab-context` flow's view: the context strip and the first run read it. */
export interface AppContext {
  /** The working folder. */
  folder: string;
  /** Why a coding run's checkout of the folder would be refused, or `null`. */
  folderProblem: string | null;
  model: string;
  /** The harness a coding worker whose file names none runs on. */
  harness: string;
  /** Each worker's declared delegates, by id: ids, or `"all"`. */
  delegates: Record<string, "all" | string[]>;
}

/** The reads of what the app works on and with. */
export interface SetupCalls {
  /** What the lab works on and with, read once for the context strip. */
  readContext(): Promise<AppContext>;
  /** Which coding harnesses can run on this machine; `refresh` checks them again (Re-check). */
  readHarnesses(refresh?: boolean): Promise<AppHarness[]>;
}

/** {@link SetupCalls} over one client. */
export function setupCalls(client: Client): SetupCalls {
  return {
    async readContext() {
      return (await client.view(LAB_CONTEXT_VIEW, {})).value;
    },
    async readHarnesses(refresh = false) {
      return (await client.view(READINESS_VIEW, { refresh })).value;
    },
  };
}
