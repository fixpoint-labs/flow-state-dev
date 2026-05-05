/**
 * JSON-RPC 2.0 error codes used by the MCP transport adapter, plus a
 * tiny mapper from framework errors to JSON-RPC error envelopes.
 *
 * The MCP spec inherits the JSON-RPC numeric error codes and adds a few
 * application-level codes in the `-32000…-32099` range. We use:
 *
 *   -32700  Parse error (malformed JSON body)
 *   -32600  Invalid Request (missing/invalid jsonrpc framing or unsupported header)
 *   -32601  Method not found / action not exposed / unknown flow
 *   -32602  Invalid params (failed to bind arguments to action input)
 *   -32000  Server busy / capacity exceeded
 *   -32001  Authorization required
 *   -32002  Resource access denied / unsupported in v1
 */
export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_SERVER_BUSY = -32000;
export const JSON_RPC_UNAUTHORIZED = -32001;
export const JSON_RPC_RESOURCE_DENIED = -32002;

/** A single JSON-RPC error object as it appears on the wire. */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Construct a `JsonRpcError` with optional `data` payload. */
export function jsonRpcError(code: number, message: string, data?: unknown): JsonRpcError {
  return data === undefined ? { code, message } : { code, message, data };
}
