import "@flow-state-dev/devtool/react/styles.css";

// Skip static generation — the panel is browser-only (localStorage,
// EventSource, window event listeners) and there's no value in pre-rendering
// a dev tool.
export const dynamic = "force-dynamic";

/**
 * Per-route layout for the embedded DevTool. Importing the panel's CSS here
 * (instead of the root layout) keeps Tailwind v4's `@source` scanning
 * isolated to this route, so the kitchen-sink globals don't leak panel
 * styles and vice versa.
 */
export default function DevToolLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen w-screen">{children}</div>;
}
