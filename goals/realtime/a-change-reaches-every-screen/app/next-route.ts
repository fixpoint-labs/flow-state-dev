/**
 * The fixture app's Next route (FIX-2368): what
 * `app/api/flows/[...path]/route.ts` exports in a Next app, over the same
 * `FlowState` the Node host serves.
 */
import { createNextHandler } from "@flow-state-dev/next";
import { app } from "./flowstate.ts";

export const { GET, POST, PATCH, DELETE } = createNextHandler(app);
