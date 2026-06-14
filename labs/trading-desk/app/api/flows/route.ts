import { getRouter } from "@/lib/server";
import { type NextRequest } from "next/server";

// Next.js `[...path]` catch-all requires at least one segment, so requests to
// the bare `/api/flows` endpoint (no trailing segments) need this sibling
// route file. It forwards to the same router with an empty path array.
export async function GET(req: NextRequest) {
  return (await getRouter()).GET(req, { params: { path: [] } });
}

export async function POST(req: NextRequest) {
  return (await getRouter()).POST(req, { params: { path: [] } });
}
