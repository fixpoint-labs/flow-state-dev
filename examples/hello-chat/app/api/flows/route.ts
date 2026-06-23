import { flowstate } from "@/lib/server";
import { type NextRequest } from "next/server";

// Next.js `[...path]` catch-all requires at least one segment, so requests to
// the bare `/api/flows` endpoint (no trailing segments) need this sibling route
// file. It forwards to the same router with an empty path array.
export async function GET(req: NextRequest) {
  const router = await flowstate.getRouter();
  return router.GET(req, { params: { path: [] } });
}

export async function POST(req: NextRequest) {
  const router = await flowstate.getRouter();
  return router.POST(req, { params: { path: [] } });
}
