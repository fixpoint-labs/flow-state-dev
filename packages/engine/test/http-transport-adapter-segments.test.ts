/**
 * The HTTP adapter reaches `parseFlowRoute` two ways: with the decoded
 * `params.path` a framework catch-all hands over, or, without one, from the
 * raw `Request.url`. Both must resolve an id to exactly what the client
 * encoded, whitespace and percent escapes included. A topic `" report "`
 * trimmed to `"report"` reads the wrong item, or 404s.
 */
import { describe, expect, it } from "vitest";
import { createHttpTransportAdapter } from "../src/transports/http/createHttpTransportAdapter";
import { parseFlowRoute, type ParsedFlowRoute } from "../src/routes/parseFlowRoute";

const TOPIC = " report ";
const KIND = "org%5Fpentest%5Flab.helper";

async function routeVia(
  url: string,
  params: Record<string, unknown>,
  basePath?: string
): Promise<ParsedFlowRoute> {
  let parsed: ParsedFlowRoute | undefined;
  const adapter = createHttpTransportAdapter({
    ...(basePath === undefined ? {} : { basePath }),
    handle: async (request, { path }) => {
      parsed = parseFlowRoute(request.method, path);
      return new Response(null, { status: 204 });
    }
  });
  const [route] = adapter.createBindings({} as never).routes;
  await route!.handler(new Request(url), { params } as never);
  return parsed!;
}

const contentUrl = `http://localhost/api/flows/sessions/s1/resources/notes/${encodeURIComponent(TOPIC)}/content`;
const expected = { kind: "get_collection_item_content", sessionId: "s1", ref: "notes", topic: TOPIC };

describe("createHttpTransportAdapter — ids reach the route as the client encoded them", () => {
  it("keeps a whitespace-bearing topic from the params path", async () => {
    const path = ["sessions", "s1", "resources", "notes", TOPIC, "content"];
    expect(await routeVia(contentUrl, { path })).toEqual(expected);
  });

  it("keeps a whitespace-bearing topic from the Request.url fallback", async () => {
    expect(await routeVia(contentUrl, {})).toEqual(expected);
  });

  it("strips a basePath that needs encoding on the Request.url fallback", async () => {
    const url = `http://localhost/api/my%20path/sessions/s1/resources/notes/${encodeURIComponent(TOPIC)}/content`;
    expect(await routeVia(url, {}, "/api/my path")).toEqual(expected);
  });

  it("keeps a percent escape in a flow kind from the Request.url fallback", async () => {
    const url = `http://localhost/api/flows/${encodeURIComponent(KIND)}/requests/r1/stream`;
    expect(await routeVia(url, {})).toEqual({ kind: "request_stream", flowKind: KIND, requestId: "r1" });
  });
});
