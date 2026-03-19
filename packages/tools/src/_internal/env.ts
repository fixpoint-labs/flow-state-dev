export function detectApiKey(envVar: string): string | undefined {
  return typeof process !== "undefined" ? process.env[envVar] : undefined;
}
