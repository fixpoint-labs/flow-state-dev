/**
 * Behavior parity tests for the path-to-regexp-backed router. Every branch
 * of the legacy `parseFlowRoute` if-chain is exercised here so any future
 * router rewrite has a single coverage anchor. Includes adapter pattern
 * compilation tests for the `:param` and trailing-`*` shapes.
 */
import { describe, expect, it } from "vitest";
import {
  decodePathSegments,
  parseFlowRoute,
  type ParsedFlowRoute
} from "../src/routes/parseFlowRoute";
import {
  compileTransportPattern,
  matchTransportRoute
} from "../src/routes/router";

function parse(method: string, path: string): ParsedFlowRoute {
  // Mimic what the catch-all dispatcher passes — split on `/` and drop empties.
  const segments = path.split("/").filter((s) => s.length > 0);
  return parseFlowRoute(method, segments);
}

describe("parseFlowRoute (router-backed)", () => {
  describe("collection-less routes", () => {
    it("GET / → list_flows", () => {
      expect(parse("GET", "/")).toEqual({ kind: "list_flows" });
    });

    it("GET /capabilities → capabilities", () => {
      expect(parse("GET", "/capabilities")).toEqual({ kind: "capabilities" });
    });

    it("GET /sessions → list_sessions", () => {
      expect(parse("GET", "/sessions")).toEqual({ kind: "list_sessions" });
    });

    it("GET /active-requests → active_requests", () => {
      expect(parse("GET", "/active-requests")).toEqual({ kind: "active_requests" });
    });

    it("POST /transcribe → transcribe", () => {
      expect(parse("POST", "/transcribe")).toEqual({ kind: "transcribe" });
    });
  });

  describe("session routes", () => {
    it("GET /sessions/:sessionId → get_session", () => {
      expect(parse("GET", "/sessions/sess_123")).toEqual({
        kind: "get_session",
        sessionId: "sess_123"
      });
    });

    it("DELETE /sessions/:sessionId → delete_session", () => {
      expect(parse("DELETE", "/sessions/sess_123")).toEqual({
        kind: "delete_session",
        sessionId: "sess_123"
      });
    });

    it("PATCH /sessions/:sessionId/metadata → patch_session_metadata", () => {
      expect(parse("PATCH", "/sessions/sess_42/metadata")).toEqual({
        kind: "patch_session_metadata",
        sessionId: "sess_42"
      });
    });

    it("GET /sessions/:sessionId/requests → list_session_requests", () => {
      expect(parse("GET", "/sessions/sess_42/requests")).toEqual({
        kind: "list_session_requests",
        sessionId: "sess_42"
      });
    });

    it("GET /sessions/:sessionId/state → get_session_state", () => {
      expect(parse("GET", "/sessions/sess_42/state")).toEqual({
        kind: "get_session_state",
        sessionId: "sess_42"
      });
    });
  });

  describe("user routes", () => {
    it("GET /users/:userId/stream → user_stream", () => {
      expect(parse("GET", "/users/user_42/stream")).toEqual({
        kind: "user_stream",
        userId: "user_42"
      });
    });

    it("POST /users/:userId/check-interrupted → check_interrupted_requests", () => {
      expect(parse("POST", "/users/user_42/check-interrupted")).toEqual({
        kind: "check_interrupted_requests",
        userId: "user_42"
      });
    });
  });

  describe("flow-scoped routes", () => {
    it("POST /:flowKind/sessions → create_session", () => {
      expect(parse("POST", "/chat-agent/sessions")).toEqual({
        kind: "create_session",
        flowKind: "chat-agent"
      });
    });

    it("POST /:flowKind/actions/:actionName → execute_action (sessionless)", () => {
      expect(parse("POST", "/chat-agent/actions/run")).toEqual({
        kind: "execute_action",
        flowKind: "chat-agent",
        actionName: "run"
      });
    });

    it("POST /:flowKind/:sessionId/actions/:actionName → execute_action (with session)", () => {
      expect(parse("POST", "/chat-agent/sess_99/actions/run")).toEqual({
        kind: "execute_action",
        flowKind: "chat-agent",
        sessionId: "sess_99",
        actionName: "run"
      });
    });

    it("GET /:flowKind/requests/:requestId/stream → request_stream", () => {
      expect(parse("GET", "/chat-agent/requests/req_1/stream")).toEqual({
        kind: "request_stream",
        flowKind: "chat-agent",
        requestId: "req_1"
      });
    });

    it("POST /:flowKind/requests/:requestId/abort → abort_request", () => {
      expect(parse("POST", "/chat-agent/requests/req_1/abort")).toEqual({
        kind: "abort_request",
        flowKind: "chat-agent",
        requestId: "req_1"
      });
    });

    it("GET /:flowKind/requests/:requestId/status → request_status", () => {
      expect(parse("GET", "/chat-agent/requests/req_1/status")).toEqual({
        kind: "request_status",
        flowKind: "chat-agent",
        requestId: "req_1"
      });
    });

    it("POST /:flowKind/sessions/:sessionId/requests/:requestId/retry → retry_request", () => {
      expect(
        parse("POST", "/chat-agent/sessions/sess_1/requests/req_2/retry")
      ).toEqual({
        kind: "retry_request",
        flowKind: "chat-agent",
        sessionId: "sess_1",
        requestId: "req_2"
      });
    });
  });

  describe("resource routes", () => {
    it("GET /sessions/:sessionId/resources/:ref/content → get_resource_content", () => {
      expect(
        parse("GET", "/sessions/sess_1/resources/profile/content")
      ).toEqual({
        kind: "get_resource_content",
        sessionId: "sess_1",
        ref: "profile"
      });
    });

    it("GET /sessions/:sessionId/resources/:ref/:topic/content → get_collection_item_content", () => {
      expect(
        parse("GET", "/sessions/sess_1/resources/notes/note_42/content")
      ).toEqual({
        kind: "get_collection_item_content",
        sessionId: "sess_1",
        ref: "notes",
        topic: "note_42"
      });
    });

    it("POST /sessions/:sessionId/resources/:ref → create_collection_item", () => {
      expect(parse("POST", "/sessions/sess_1/resources/notes")).toEqual({
        kind: "create_collection_item",
        sessionId: "sess_1",
        ref: "notes"
      });
    });

    it("PATCH /sessions/:sessionId/resources/:ref/:topic/content → update_resource_content", () => {
      expect(
        parse("PATCH", "/sessions/sess_1/resources/notes/note_42/content")
      ).toEqual({
        kind: "update_resource_content",
        sessionId: "sess_1",
        ref: "notes",
        topic: "note_42"
      });
    });

    it("DELETE /sessions/:sessionId/resources/:ref/:topic → delete_collection_item", () => {
      expect(
        parse("DELETE", "/sessions/sess_1/resources/notes/note_42")
      ).toEqual({
        kind: "delete_collection_item",
        sessionId: "sess_1",
        ref: "notes",
        topic: "note_42"
      });
    });

    it("GET /sessions/:sessionId/resources/:ref → list_collection_state", () => {
      expect(parse("GET", "/sessions/sess_1/resources/notes")).toEqual({
        kind: "list_collection_state",
        sessionId: "sess_1",
        ref: "notes"
      });
    });

    it("GET /sessions/:sessionId/resources/:ref/:topic → get_collection_item_state", () => {
      expect(parse("GET", "/sessions/sess_1/resources/notes/note_42")).toEqual({
        kind: "get_collection_item_state",
        sessionId: "sess_1",
        ref: "notes",
        topic: "note_42"
      });
    });

    it("multi-segment topic — get_collection_item_state captures `p1/fundamentals`", () => {
      // Collection patterns like `memos/**` produce topic keys with slashes
      // (e.g. `p1/fundamentals`). The router must capture the full topic
      // rather than 404 because the parameter is single-segment. Regression
      // for the bug where trading-desk memo fetches returned 404.
      expect(
        parse("GET", "/sessions/sess_1/resources/memos/p1/fundamentals")
      ).toEqual({
        kind: "get_collection_item_state",
        sessionId: "sess_1",
        ref: "memos",
        topic: "p1/fundamentals"
      });
    });

    it("multi-segment topic — get_collection_item_content captures across slashes", () => {
      expect(
        parse(
          "GET",
          "/sessions/sess_1/resources/memos/p1/fundamentals/content"
        )
      ).toEqual({
        kind: "get_collection_item_content",
        sessionId: "sess_1",
        ref: "memos",
        topic: "p1/fundamentals"
      });
    });

    it("multi-segment topic — delete_collection_item captures across slashes", () => {
      expect(
        parse(
          "DELETE",
          "/sessions/sess_1/resources/memos/p2/research-manager"
        )
      ).toEqual({
        kind: "delete_collection_item",
        sessionId: "sess_1",
        ref: "memos",
        topic: "p2/research-manager"
      });
    });

    it("GET /sessions/:sessionId/resources/:ref/content prefers content over state-get (literal segment wins)", () => {
      // Topics literally called "content" are not addressable via the state-get
      // route; the existing /content endpoint takes precedence by literal-segment
      // specificity. Documented as a routing constraint.
      expect(
        parse("GET", "/sessions/sess_1/resources/profile/content")
      ).toEqual({
        kind: "get_resource_content",
        sessionId: "sess_1",
        ref: "profile"
      });
    });

    it("GET /sessions/:sessionId/manifest → get_resource_manifest", () => {
      expect(parse("GET", "/sessions/sess_1/manifest")).toEqual({
        kind: "get_resource_manifest",
        sessionId: "sess_1"
      });
    });
  });

  describe("non-matching paths", () => {
    it("returns not_found for unknown paths", () => {
      expect(parse("GET", "/nope")).toEqual({ kind: "not_found" });
      expect(parse("POST", "/sessions")).toEqual({ kind: "not_found" });
      expect(parse("DELETE", "/active-requests")).toEqual({
        kind: "not_found"
      });
    });

    it("returns not_found when method does not match an existing path", () => {
      // /sessions is a valid GET path; POST should miss.
      expect(parse("POST", "/")).toEqual({ kind: "not_found" });
      expect(parse("PATCH", "/active-requests")).toEqual({ kind: "not_found" });
    });

    it("treats undefined / empty path arrays as the root path", () => {
      expect(parseFlowRoute("GET", undefined)).toEqual({ kind: "list_flows" });
      expect(parseFlowRoute("GET", [])).toEqual({ kind: "list_flows" });
    });

    it("strips empty segments, but a whitespace-only segment is an id", () => {
      expect(parseFlowRoute("GET", ["", "sessions", "", "sess_1"])).toEqual({
        kind: "get_session",
        sessionId: "sess_1"
      });
      // Decoded content is never trimmed, so "  " is a session id here and
      // the path has one segment too many for get_session.
      expect(parseFlowRoute("GET", ["", "sessions", "  ", "sess_1"])).toEqual({ kind: "not_found" });
      expect(parseFlowRoute("GET", ["sessions", "  "])).toEqual({ kind: "get_session", sessionId: "  " });
    });
  });

  describe("specificity edge cases", () => {
    it("matches dotted :flowKind values (e.g., versioned flow names)", () => {
      expect(parse("POST", "/chat.agent.v2/sessions")).toEqual({
        kind: "create_session",
        flowKind: "chat.agent.v2"
      });
    });

    it("disambiguates same-length GET paths by literal segment", () => {
      // All three are 4 segments; literals at position 3 disambiguate.
      expect(parse("GET", "/x/requests/r1/status")).toEqual({
        kind: "request_status",
        flowKind: "x",
        requestId: "r1"
      });
      expect(parse("GET", "/x/requests/r1/stream")).toEqual({
        kind: "request_stream",
        flowKind: "x",
        requestId: "r1"
      });
      expect(parse("POST", "/x/requests/r1/abort")).toEqual({
        kind: "abort_request",
        flowKind: "x",
        requestId: "r1"
      });
    });

    it("is case-insensitive on HTTP method", () => {
      expect(parse("get", "/")).toEqual({ kind: "list_flows" });
      expect(parse("Post", "/transcribe")).toEqual({ kind: "transcribe" });
    });
  });
});

describe("compileTransportPattern", () => {
  it("matches `:param` patterns and exposes captured params", () => {
    const matcher = compileTransportPattern("/api/flows/:kind/mcp");
    expect(matchTransportRoute(matcher, "/api/flows/chat/mcp")).toEqual({
      kind: "chat"
    });
    expect(matchTransportRoute(matcher, "/api/flows/chat/other")).toBeNull();
  });

  it("translates trailing `*` into `params.rest` (joined-string contract)", () => {
    const matcher = compileTransportPattern("/api/flows/*");
    expect(
      matchTransportRoute(matcher, "/api/flows/chat-agent/requests/r1/status")
    ).toEqual({
      rest: "chat-agent/requests/r1/status"
    });
  });

  it("normalizes a leading slash on the input pattern", () => {
    const matcher = compileTransportPattern("api/flows/:kind/mcp");
    expect(matchTransportRoute(matcher, "/api/flows/chat/mcp")).toEqual({
      kind: "chat"
    });
  });

  it("returns null when the pattern does not match", () => {
    const matcher = compileTransportPattern("/api/flows/:kind/mcp");
    expect(matchTransportRoute(matcher, "/wrong/path")).toBeNull();
  });
});

describe("parseFlowRoute — segments arrive decoded, and are decoded no further", () => {
  it("keeps a literal percent escape inside a flow kind", () => {
    // Next hands `params.path` decoded once; an escaped seat address still
    // carries `%5F` after that decode, and must resolve as written.
    expect(parseFlowRoute("POST", ["org%5Fpentest%5Flab.helper", "actions", "run"])).toEqual({
      kind: "execute_action",
      flowKind: "org%5Fpentest%5Flab.helper",
      actionName: "run"
    });
  });

  it("keeps whitespace inside a decoded segment (a topic \" report \" is not \"report\")", () => {
    expect(
      parseFlowRoute("GET", ["sessions", " s1 ", "resources", "notes", " report ", "content"])
    ).toEqual({
      kind: "get_collection_item_content",
      sessionId: " s1 ",
      ref: "notes",
      topic: " report "
    });
  });

  it("still drops empty segments, as a catch-all can hand them over", () => {
    expect(parseFlowRoute("GET", ["", "sessions", "abc", ""])).toEqual({
      kind: "get_session",
      sessionId: "abc"
    });
  });

  it("keeps a decoded slash inside its segment", () => {
    expect(parseFlowRoute("GET", ["sessions", "a/b"])).toEqual({
      kind: "get_session",
      sessionId: "a/b"
    });
  });
});

describe("decodePathSegments — the raw-URL host's half of the contract", () => {
  it("decodes each segment once, after splitting", () => {
    expect(decodePathSegments("org%255Fpentest%255Flab.helper/actions/run")).toEqual([
      "org%5Fpentest%5Flab.helper",
      "actions",
      "run"
    ]);
    expect(decodePathSegments("sessions/a%2Fb")).toEqual(["sessions", "a/b"]);
  });

  it("keeps a segment that is not valid percent-encoding as written", () => {
    expect(decodePathSegments("sessions/100%")).toEqual(["sessions", "100%"]);
  });

  it("round-trips a whitespace-bearing topic from the raw URL", () => {
    const raw = `sessions/s1/resources/notes/${encodeURIComponent(" report ")}/content`;
    expect(parseFlowRoute("GET", decodePathSegments(raw))).toMatchObject({ topic: " report " });
  });

  it("round-trips through parseFlowRoute to the kind the client encoded", () => {
    const kind = "acme.~alice%40acme%2Ecom.helper";
    const raw = `${encodeURIComponent(kind)}/actions/run`;
    expect(parseFlowRoute("POST", decodePathSegments(raw))).toMatchObject({ flowKind: kind });
  });
});
