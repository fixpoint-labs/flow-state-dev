// fsd:generated
import { createNextHandler } from "@flow-state-dev/next";
import flowstate from "{{CONFIG_IMPORT}}";

const handler = createNextHandler(flowstate);

export function GET(req: Request) {
  return handler.GET(req, { params: Promise.resolve({ path: [] }) });
}

export function POST(req: Request) {
  return handler.POST(req, { params: Promise.resolve({ path: [] }) });
}

export function PATCH(req: Request) {
  return handler.PATCH(req, { params: Promise.resolve({ path: [] }) });
}

export function DELETE(req: Request) {
  return handler.DELETE(req, { params: Promise.resolve({ path: [] }) });
}
