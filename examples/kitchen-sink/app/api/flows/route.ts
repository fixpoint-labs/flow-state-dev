import { createVercelBareHandler } from "@flow-state-dev/vercel";
import { getRouter } from "@/lib/server";

// Bare `/api/flows` endpoint — Next.js `[...path]` catch-all requires at
// least one segment, so this sibling route handles the zero-segment case.
export const { GET, POST } = createVercelBareHandler(getRouter);
