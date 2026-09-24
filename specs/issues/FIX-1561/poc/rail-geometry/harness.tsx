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
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { FlowNavigator as Today } from "../../../../../packages/react/src/components/flow-navigator/index";
import { FlowNavigator as Sketch, setSketchReveal } from "./sketch/FlowNavigator.sketch";

/** `?variant=today` (default) · `always` · `hover` — see README.md. */
const variant = new URLSearchParams(location.search).get("variant") ?? "today";
if (variant === "hover") setSketchReveal("hover");
const FlowNavigator = (variant === "today" ? Today : Sketch) as typeof Today;

type Entry = { id: string; kind: string; cardinality: "singleton" | "collection" };

const flows: Entry[] = [
  { id: "support.iris", kind: "agent", cardinality: "collection" },
  { id: "support.otto", kind: "agent", cardinality: "collection" },
  { id: "support.ada", kind: "desk-clerk", cardinality: "collection" },
  { id: "support.grace", kind: "desk-clerk", cardinality: "collection" },
  { id: "digest", kind: "digest", cardinality: "singleton" },
  { id: "support.wren", kind: "followup-runner", cardinality: "collection" },
];

/** Sessions per leaf address. Engine-minted ids have no title, as in the screenshot. */
const sessions: Record<string, { id: string; title?: string }[]> = {
  "support.iris": [{ id: "sess_1790206121611_42636c63df102" }],
  "support.otto": [],
  "support.ada": [{ id: "sess_1790206133090_9f1e07ab55c3" }, { id: "sess_1790206140712_0c4d2e91aa7f" }],
  "support.grace": [{ id: "sess_1790206151208_7b2a90cc1e40" }],
  digest: [{ id: "support.noticeboard" }],
  "support.wren": [{ id: "sess_1790206170444_e3a19b62f08d" }],
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

const iconButton = (label: string, glyph: string) =>
  h(
    "button",
    {
      type: "button",
      "aria-label": label,
      title: label,
      "data-host-action": label,
      style: {
        width: 20,
        height: 20,
        padding: 0,
        border: "none",
        background: "transparent",
        color: "rgb(100 116 139)",
        font: "inherit",
        fontSize: 12,
        cursor: "pointer",
      },
    },
    glyph,
  );

const THEME = {
  "--fsd-nav-fg": "rgb(226 232 240)",
  "--fsd-nav-muted-fg": "rgb(100 116 139)",
  "--fsd-nav-selected-bg": "rgb(30 41 59)",
  "--fsd-nav-font-size": "13px",
  "--fsd-nav-note-font-size": "10px",
  "--fsd-nav-section-font-size": "10px",
  width: 300,
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
        rowTrailing: (row) => (row.type === "instance" ? iconButton("Copy id", "⧉") : null),
        leafToolbar: () =>
          h(
            "div",
            { style: { display: "flex", justifyContent: "flex-end", gap: 4, padding: "4px 0" } },
            iconButton("Refresh sessions", "⟳"),
            iconButton("New session", "+"),
          ),
      },
    }),
  ),
);
