import { ChevronLeft, ChevronRight, PanelLeft, Send } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { readBaseUrl, writeBaseUrl } from "@/config";

const NAV_EXPANDED_WIDTH = 240;
const NAV_COLLAPSED_WIDTH = 64;
const NAV_MAX_WIDTH = 320;
const DETAIL_DEFAULT_WIDTH = 360;
const DETAIL_MIN_WIDTH = 280;
const DETAIL_MAX_WIDTH = 520;
const MAIN_MIN_WIDTH = 560;

export function App() {
  const [navExpanded, setNavExpanded] = useState(true);
  const [navWidth, setNavWidth] = useState(NAV_EXPANDED_WIDTH);
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH);
  const [baseUrl, setBaseUrl] = useState(readBaseUrl);

  const onStartResize = (panel: "nav" | "detail", startClientX: number) => {
    const startNav = navWidth;
    const startDetail = detailWidth;

    const onMove = (event: MouseEvent) => {
      if (panel === "nav") {
        const next = Math.min(NAV_MAX_WIDTH, Math.max(NAV_COLLAPSED_WIDTH, startNav + (event.clientX - startClientX)));
        setNavWidth(next);
        return;
      }

      const delta = event.clientX - startClientX;
      const next = Math.max(DETAIL_MIN_WIDTH, Math.min(DETAIL_MAX_WIDTH, startDetail - delta));
      const maxDetail = Math.max(DETAIL_MIN_WIDTH, window.innerWidth - MAIN_MIN_WIDTH - (navExpanded ? navWidth : NAV_COLLAPSED_WIDTH));
      setDetailWidth(Math.min(next, maxDetail));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-100">
      <header className="flex h-14 items-center justify-between border-b border-slate-800 px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-wide">FSD DevTools</h1>
          <Badge variant="secondary">v0.1.0</Badge>
        </div>
        <Badge>Dark Shell</Badge>
      </header>

      <div className="flex h-[calc(100vh-3.5rem)]">
        <aside
          className="border-r border-slate-800 bg-slate-900/50 p-3"
          style={{ width: navExpanded ? `${navWidth}px` : `${NAV_COLLAPSED_WIDTH}px` }}
        >
          <Button variant="outline" size="sm" className="mb-4 flex w-full justify-between" onClick={() => setNavExpanded((current) => !current)}>
            <span className="inline-flex items-center gap-2">
              <PanelLeft className="h-4 w-4" />
              {navExpanded ? "Navigator" : null}
            </span>
            {navExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>

          <div className="space-y-2">
            {["Flows", "Sessions", "Requests"].map((item) => (
              <Card key={item} className="bg-slate-950">
                <CardContent className="p-2 text-xs text-slate-400">{navExpanded ? item : item[0]}</CardContent>
              </Card>
            ))}
          </div>
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          className="w-1 cursor-col-resize bg-slate-800/50 hover:bg-sky-500"
          onMouseDown={(event) => onStartResize("nav", event.clientX)}
        />

        <main className="flex min-w-0 flex-1 flex-col bg-slate-950">
          <div className="p-3">
            <Tabs defaultValue="stream">
              <TabsList>
                <TabsTrigger value="stream">Stream</TabsTrigger>
                <TabsTrigger value="trace">Trace</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <Separator />

          <div className="flex-1 p-4">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Main Workspace</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-500">Workspace shell placeholder</CardContent>
            </Card>
          </div>

          <Separator />

          <div className="p-3">
            <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 p-2">
              <Input placeholder="Type an action payload (non-functional)" />
              <Button size="icon" variant="outline" aria-label="Send action">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </main>

        <div
          role="separator"
          aria-orientation="vertical"
          className="w-1 cursor-col-resize bg-slate-800/50 hover:bg-sky-500"
          onMouseDown={(event) => onStartResize("detail", event.clientX)}
        />

        <aside className="border-l border-slate-800 bg-slate-900/40 p-3" style={{ width: `${detailWidth}px` }}>
          <Card>
            <CardHeader>
              <CardTitle>Client Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="base-url">Base URL</Label>
              <Input
                id="base-url"
                value={baseUrl}
                onChange={(event) => {
                  const next = event.target.value;
                  setBaseUrl(next);
                  writeBaseUrl(next);
                }}
                placeholder="http://localhost:3000"
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
