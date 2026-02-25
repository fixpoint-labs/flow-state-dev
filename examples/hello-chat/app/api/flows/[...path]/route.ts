import { router } from "@/lib/server";
import { type NextRequest } from "next/server";

// Force dynamic rendering — required for SSE streaming. Without this, Next.js
// may buffer the Response body, preventing real-time token-by-token delivery.
export const dynamic = "force-dynamic";

// Next.js 15 uses async params — unwrap the promise and forward to the
// framework's route handlers which expect the sync `{ params: { path } }` shape.
type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  return router.GET(req, { params });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  return router.POST(req, { params });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  return router.DELETE(req, { params });
}
