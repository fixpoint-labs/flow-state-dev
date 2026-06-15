import { flowstate } from "@/lib/server";
import { type NextRequest } from "next/server";

// Force dynamic rendering — required for SSE streaming. Without this, Next.js
// may buffer the Response body, preventing real-time delivery.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  const router = await flowstate.getRouter();
  return router.GET(req, { params });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  const router = await flowstate.getRouter();
  return router.POST(req, { params });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  const router = await flowstate.getRouter();
  return router.DELETE(req, { params });
}
