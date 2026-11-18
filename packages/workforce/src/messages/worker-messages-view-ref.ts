// FIX-2771 D1.
/**
 * The client's handle on the worker messages view: the roster flow's address
 * and the view's name, typed by the view through a type import. Holds no
 * block, so it is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { ROSTER_FLOW, WORKER_MESSAGES_VIEW } from "../workers/keys";
import type { WorkerMessagesView } from "./worker-messages-view";

/** A worker's open messages, and the rows and answers of the messages on screen: `useView(workerMessagesViewRef(), { worker, ids })`. */
export const workerMessagesViewRef = () => viewRef<WorkerMessagesView>(ROSTER_FLOW, WORKER_MESSAGES_VIEW);
