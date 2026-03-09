const BASE_URL_KEY = "fsd.devtool.baseUrl";
const DEFAULT_BASE_URL = "http://localhost:3000";

export function readBaseUrl(): string {
  if (typeof window === "undefined") {
    return DEFAULT_BASE_URL;
  }

  const stored = window.localStorage.getItem(BASE_URL_KEY);
  return stored?.trim() ? stored : DEFAULT_BASE_URL;
}

export function writeBaseUrl(baseUrl: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(BASE_URL_KEY, baseUrl.trim());
}
