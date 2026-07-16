/**
 * Inject a DevTool connection config into the served `index.html` as a
 * `window.__FSD_DEVTOOL_CONFIG__` global that the DevTool page reads on boot.
 *
 * Used only by `fsdev dev` (loopback), so the injected bearer token — a local
 * dev secret — never leaves the operator's machine. The production `serve`
 * path passes no config and this is never applied.
 */
import type { DevToolConnectionConfig } from "@flow-state-dev/engine";

const GLOBAL = "window.__FSD_DEVTOOL_CONFIG__";

/**
 * Serialize `config` as a `<script>` that assigns the global, escaping unsafe
 * characters so the value can't break out of the tag, then insert it just
 * before `</head>` (falling back to before `</body>`, then appended). Returns
 * the HTML unchanged if `config` has no usable fields.
 */
export function injectDevtoolConfig(
  html: string,
  config: DevToolConnectionConfig
): string {
  // Only inject values the DevTool reader will actually use — it ignores
  // whitespace-only values (trims before use), so a blank config field must not
  // land in the page global where it would silently shadow the default.
  const clean: DevToolConnectionConfig = {};
  if (typeof config.userId === "string" && config.userId.trim().length > 0) {
    clean.userId = config.userId;
  }
  if (typeof config.bearerToken === "string" && config.bearerToken.trim().length > 0) {
    clean.bearerToken = config.bearerToken;
  }
  if (Object.keys(clean).length === 0) return html;

  // Escape `<` (so a value can't close the <script>) and the U+2028/U+2029 line
  // separators (invalid raw in a JS string literal) so the serialized JSON is
  // safe to embed inside a <script> element.
  const json = JSON.stringify(clean)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const tag = `<script>${GLOBAL} = ${json};</script>`;

  const headClose = html.toLowerCase().indexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + tag + html.slice(headClose);
  }
  const bodyClose = html.toLowerCase().indexOf("</body>");
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + tag + html.slice(bodyClose);
  }
  return html + tag;
}
