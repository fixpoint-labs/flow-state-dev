import flowstate from "@/fsdev.config";
import { type NextRequest } from "next/server";

// Force dynamic rendering — required for SSE streaming. Without this, Next.js
// may buffer the Response body, preventing real-time token-by-token delivery.
export const dynamic = "force-dynamic";

// `[[...path]]` is an optional catch-all: the bare `/api/flows` (the flow list
// the client reads) arrives with no `path`, everything under it with the
// segments. Next.js 15 passes `params` as a promise; unwrap it and forward the
// sync `{ params: { path } }` shape the framework's router expects.
type RouteContext = { params: Promise<{ path?: string[] }> };

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
