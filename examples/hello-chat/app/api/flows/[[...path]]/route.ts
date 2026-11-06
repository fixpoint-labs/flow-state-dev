import flowstate from "@/fsdev.config";
import { createNextHandler } from "@flow-state-dev/next";

// Force dynamic rendering — required for SSE streaming. Without this, Next.js
// may buffer the Response body, preventing real-time token-by-token delivery.
export const dynamic = "force-dynamic";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate);
