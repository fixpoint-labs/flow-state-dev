/**
 * FIX-1561 POC · the rail the owner photographed, rendered from the real
 * `FlowNavigator` source with fixture data. Experimental evidence retained with
 * the spec; not production code and not imported by anything.
 *
 * The fixture mirrors the screenshot: four kinds, three of them collections and
 * one (`digest`) a singleton whose one session is the `support.noticeboard`
 * channel. The slots mimic the DevTool host's: a copy button on instance rows,
 * and a refresh + new-session strip in `leafToolbar`, right-aligned the way the
 * DevTool draws it.
 *
 * `?variant=` picks today's component or the sketch in `sketch/`.
 */
import { Fragment, createElement as h } from "react";
import { Copy, Plus, RefreshCw } from "lucide-react";
import { Button } from "../../../../../packages/devtool/src/react/components/ui/button";
import { createRoot } from "react-dom/client";
import { FlowNavigator as Today } from "../../../../../packages/react/src/components/flow-navigator/index";
import { FlowNavigator as Sketch, setSketchBroken, setSketchHoverOnly, setSketchReveal } from "./sketch/FlowNavigator.sketch";

/**
 * `?variant=today` (default) · `always` · `hover` — see README.md.
 * `?long=1` adds an instance and a session whose labels overflow any rail;
 * `?width=` sets the rail's width; `?break=1` is the narrow check's negative
 * control (sketch only).
 */
const params = new URLSearchParams(location.search);
const variant = params.get("variant") ?? "today";
if (variant === "hover") setSketchReveal("hover");
if (params.get("break") === "1") setSketchBroken(true);
if (params.get("nofocus") === "1") setSketchHoverOnly(true);
const FlowNavigator = (variant === "today" ? Today : Sketch) as typeof Today;
const LONG = params.get("long") === "1";
const WIDTH = Number(params.get("width") ?? 300);

type Entry = { id: string; kind: string; cardinality: "singleton" | "collection" };

const flows: Entry[] = [
  { id: "support.iris", kind: "agent", cardinality: "collection" },
  { id: "support.otto", kind: "agent", cardinality: "collection" },
  { id: "support.ada", kind: "desk-clerk", cardinality: "collection" },
  { id: "support.grace", kind: "desk-clerk", cardinality: "collection" },
  { id: "digest", kind: "digest", cardinality: "singleton" },
  { id: "support.wren", kind: "followup-runner", cardinality: "collection" },
  ...(LONG
    ? [{ id: "support.escalations-overnight-weekend-queue", kind: "desk-clerk", cardinality: "collection" as const }]
    : []),
];

/** Sessions per leaf address. Engine-minted ids have no title, as in the screenshot. */
const sessions: Record<string, { id: string; title?: string }[]> = {
  "support.iris": [{ id: "sess_1790206121611_42636c63df102" }],
  "support.otto": [],
  "support.ada": [{ id: "sess_1790206133090_9f1e07ab55c3" }, { id: "sess_1790206140712_0c4d2e91aa7f" }],
  "support.grace": [{ id: "sess_1790206151208_7b2a90cc1e40" }],
  digest: [{ id: "support.noticeboard" }],
  "support.wren": [{ id: "sess_1790206170444_e3a19b62f08d" }],
  "support.escalations-overnight-weekend-queue": [
    { id: "sess_1790206180000_5d0c11aa9e21", title: "Refund escalation for order 4417 and both linked chargebacks" },
  ],
};

const client = {
  listFlows: async () =>
    flows.map((f) => ({ ...f, requireUser: false, actions: [] })),
};

const sessionClient = {
  listSessions: async (options: { flowId?: string; flowKind?: string } = {}) => {
    const key = options.flowId ?? options.flowKind ?? "";
    return (sessions[key] ?? []).map((s, i) => ({
      ...s,
      flowKind: key,
      userId: "devuser",
      createdAt: 1790206121611 + i,
      updatedAt: 1790206121611 + i,
    }));
  },
};

/*
 * The DevTool's own affordances: its button, its icon set, and its class
 * strings copied verbatim from `packages/devtool/.../flows/flow-rail.tsx`, so
 * the icon sizes measured here are the ones the owner sees. `measure.mjs`
 * compiles the Tailwind these classes need.
 *
 * Today every icon box is 16px: the Button's `[&_svg:not([class*='size-'])]`
 * rule overrides the declared `h-3 w-3`. The boxes match, but the drawings
 * don't: Copy's covers 20 of its 24 grid units, RefreshCw's 18, Plus's 14.
 *
 * `?icons=equal` applies the proposed host fix: each icon is sized so its
 * drawing covers the same 11px, with one absolute stroke width, set inline so
 * the Button's rule cannot override it. The hit area stays the 20px button.
 */
const equalIcons = new URLSearchParams(location.search).get("icons") === "equal";
const DRAWN = 11;
const EXTENT = new Map<unknown, number>([
  [Copy, 20],
  [RefreshCw, 18],
  [Plus, 14],
]);
const icon = (Icon: typeof Plus) => {
  if (!equalIcons) return h(Icon, { className: "h-3 w-3 text-slate-500" });
  const box = (DRAWN * 24) / EXTENT.get(Icon)!;
  return h(Icon, {
    className: "text-slate-500",
    style: { width: box, height: box },
    strokeWidth: 1.5,
    absoluteStrokeWidth: true,
  });
};

const copyButton = (flowId: string) =>
  h(
    Button,
    {
      variant: "ghost",
      size: "sm",
      className: "h-5 w-5 p-0",
      title: `Copy instance ID: ${flowId}`,
      "aria-label": `Copy instance ID ${flowId}`,
      "data-host-action": "copy",
    },
    icon(Copy),
  );

const toolbarButton = (title: string, Icon: typeof Plus) =>
  h(
    Button,
    { variant: "ghost", size: "sm", className: "h-5 w-5 p-0", title, "data-host-action": title },
    icon(Icon),
  );

const toolbarButtons = () => [
  toolbarButton("Refresh sessions", RefreshCw),
  toolbarButton("New session", Plus),
];

const THEME = {
  "--fsd-nav-fg": "rgb(226 232 240)",
  "--fsd-nav-muted-fg": "rgb(100 116 139)",
  "--fsd-nav-selected-bg": "rgb(30 41 59)",
  "--fsd-nav-font-size": "13px",
  "--fsd-nav-note-font-size": "10px",
  "--fsd-nav-section-font-size": "10px",
  "--fsd-nav-guide": "rgb(71 85 105)",
  width: WIDTH,
  height: "100vh",
  background: "rgb(15 23 42)",
  fontFamily: "system-ui, sans-serif",
} as Record<string, unknown>;

createRoot(document.getElementById("root")!).render(
  h(
    "div",
    { style: THEME, "data-testid": "rail" },
    h(FlowNavigator, {
      sections: [{ label: "Flows" }],
      client: client as never,
      sessionClient: sessionClient as never,
      userId: "devuser",
      onSelectSession: () => {},
      slots: {
        rowTrailing: (row) => (row.type === "instance" ? copyButton(row.instance.id) : null),
        // Today the DevTool wraps its two buttons in a right-aligned strip; the
        // sketch drops the wrapper because the row does the aligning (PLAN S6).
        leafToolbar: () =>
          variant === "today"
            ? h("div", { className: "flex items-center justify-end gap-1 py-1" }, ...toolbarButtons())
            : h(Fragment, null, ...toolbarButtons()),
      },
    }),
  ),
);
