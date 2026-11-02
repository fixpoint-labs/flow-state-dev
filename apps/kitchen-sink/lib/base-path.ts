/**
 * The path prefix the app is built under (`next.config.mjs` `basePath`), `""`
 * at the root of its origin. Next prefixes its own links, routes and assets;
 * a flow client's `baseUrl` is a plain URL, so it takes this prefix itself.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
