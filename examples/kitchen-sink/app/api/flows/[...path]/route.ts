import { getRouter } from "@/lib/server";
import { type NextRequest } from "next/server";

// Prevent Next.js from buffering SSE responses.
export const dynamic = "force-dynamic";

// Next.js 15 uses async params — unwrap the promise and forward to the
// framework's route handlers which expect the sync `{ params: { path } }` shape.
type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const [router, params] = await Promise.all([getRouter(), ctx.params]);
  return router.GET(req, { params });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const [router, params] = await Promise.all([getRouter(), ctx.params]);
  return router.POST(req, { params });
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const [router, params] = await Promise.all([getRouter(), ctx.params]);
  return router.PATCH(req, { params });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const [router, params] = await Promise.all([getRouter(), ctx.params]);
  return router.DELETE(req, { params });
}
