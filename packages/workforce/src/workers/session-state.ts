/**
 * Worker installations and their blocks share the field schemas in this module so
 * the flow can merge their declarations, including constrained fields such as routedFrom.
 */
import { z } from "zod";
import { taskChainSchema } from "../conversation-board/chain";
import {
  FILING_FLOW_STATE_KEY,
  FILING_PROJECT_STATE_KEY,
  FILING_SESSION_STATE_KEY,
  FILING_WORKER_STATE_KEY,
  FILING_WORKSTREAM_STATE_KEY,
  PROJECT_STATE_KEY,
  ROUTED_FROM_STATE_KEY,
  TASK_CHAIN_STATE_KEY,
  TASK_FLOW_STATE_KEY,
  TASK_ID_STATE_KEY,
  TASK_TITLE_STATE_KEY,
  WORKER_ID_STATE_KEY,
  WORKER_NAME_STATE_KEY,
  WORKSTREAM_STATE_KEY,
  WORK_PROJECT_STATE_KEY
} from "./keys";

/** The readonly birth fields and server-owned links shared by worker flows and their blocks. */
export const workerSessionStateSchema = z.object({
  [WORKER_ID_STATE_KEY]: z.string().min(1).readonly(),
  [FILING_SESSION_STATE_KEY]: z.string().min(1).readonly().optional(),
  [WORKSTREAM_STATE_KEY]: z.string().min(1).readonly().optional(),
  // Written by the `work` entry when it starts a routed task here (FIX-2083): server-owned.
  [ROUTED_FROM_STATE_KEY]: z.string().min(1).optional(),
  [TASK_ID_STATE_KEY]: z.string().min(1).readonly().optional(),
  // Written by the create check from the worker it reads (FIX-2881).
  [WORKER_NAME_STATE_KEY]: z.string().min(1).readonly().optional(),
  // Written by the hand-over beside the task id; not readonly, so an edited title never blocks adoption (FIX-2881).
  [TASK_TITLE_STATE_KEY]: z.string().min(1).optional(),
  [FILING_FLOW_STATE_KEY]: z.string().min(1).readonly().optional(),
  [FILING_WORKER_STATE_KEY]: z.string().min(1).readonly().optional(),
  [TASK_CHAIN_STATE_KEY]: taskChainSchema.readonly().optional(),
  [TASK_FLOW_STATE_KEY]: z.string().min(1).readonly().optional(),
  [FILING_WORKSTREAM_STATE_KEY]: z.string().min(1).readonly().optional(),
  [FILING_PROJECT_STATE_KEY]: z.string().min(1).readonly().optional(),
  [PROJECT_STATE_KEY]: z.string().min(1).readonly().optional(),
  // Written only by the work-project action (FIX-2161): server-owned, and changeable.
  [WORK_PROJECT_STATE_KEY]: z.string().min(1).optional()
} as const);
