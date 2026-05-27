import { createVercelNextHandler } from "@flow-state-dev/vercel/next";
import { flowstate } from "@/lib/flowstate";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);

// Next.js reads these statically — must be literal declarations, not re-exports.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
