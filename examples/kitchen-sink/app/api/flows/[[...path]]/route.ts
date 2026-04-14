import { createVercelHandler } from "@flow-state-dev/vercel";
import { getRouter } from "@/lib/server";

export const { GET, POST, PATCH, DELETE } = createVercelHandler(getRouter);

export { runtime, maxDuration, dynamic } from "@flow-state-dev/vercel/config";
