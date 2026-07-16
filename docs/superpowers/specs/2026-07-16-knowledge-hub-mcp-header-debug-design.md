# Knowledge Hub MCP Header Debug Logging

## Summary

Add an opt-in diagnostic to the Knowledge Hub lab that prints inbound MCP
request headers so the owner can verify whether Cursor sends
`Mcp-Session-Id`. The diagnostic must never print the `Authorization` header.

## Design

Wrap the existing bearer-secret principal resolver in
`labs/knowledge-hub/src/flow.ts`. When `KH_DEBUG_MCP_HEADERS=1` and the
principal-resolution context contains an HTTP request, copy its headers,
remove `authorization`, and write the remaining record to the server console.
Then delegate unchanged to the existing resolver.

Keeping the wrapper in the lab limits the behavior to Knowledge Hub. It does
not add public MCP adapter API or affect other flows. Principal resolution runs
for authenticated MCP methods such as `tools/list` and `tools/call`, which is
where a client would echo a session header after initialization. The existing
MCP adapter remains stateless and continues not to issue `Mcp-Session-Id`.

## Safety and failure behavior

- Logging is disabled unless `KH_DEBUG_MCP_HEADERS` is exactly `1`.
- `Authorization` is omitted rather than masked.
- Missing non-HTTP request objects produce no diagnostic.
- Authentication results and errors remain those of
  `createBearerSecretPrincipalResolver`.

## Verification

1. Unit-test the wrapper with logging disabled: no console output.
2. Unit-test it with logging enabled: ordinary headers and
   `mcp-session-id` are logged, while `authorization` is absent.
3. Confirm the wrapped resolver still accepts the configured bearer secret.
4. Run the relevant Knowledge Hub tests and typecheck.

No changeset is needed because this is an internal lab-only diagnostic.
