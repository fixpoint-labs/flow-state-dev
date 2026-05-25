import { createVercelBareHandler } from "@flow-state-dev/vercel";
import { flowstate } from "@/lib/flowstate";

// Bare `/api/flows` endpoint — Next.js `[...path]` catch-all requires at
// least one segment, so this sibling route handles the zero-segment case.
export const { GET, POST } = createVercelBareHandler(() => flowstate.getRouter());
