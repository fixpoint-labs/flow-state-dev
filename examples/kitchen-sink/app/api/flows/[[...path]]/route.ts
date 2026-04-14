import { createVercelHandler } from "@flow-state-dev/vercel";
import { getRouter } from "@/lib/server";

export const { GET, POST, PATCH, DELETE } = createVercelHandler(getRouter);

// Next.js reads these statically — they must be literal declarations, not re-exports.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
