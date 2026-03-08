"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type Mode = "chat" | "plan" | "review" | "rlm";

interface ModeSelectorProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  disabled?: boolean;
}

export function ModeSelector({ mode, onModeChange, disabled }: ModeSelectorProps) {
  return (
    <Tabs value={mode} onValueChange={(v) => onModeChange(v as Mode)}>
      <TabsList className="h-8">
        <TabsTrigger value="chat" disabled={disabled} className="text-xs">
          Chat
        </TabsTrigger>
        <TabsTrigger value="plan" disabled={disabled} className="text-xs">
          Plan
        </TabsTrigger>
        <TabsTrigger value="review" disabled={disabled} className="text-xs">
          Review
        </TabsTrigger>
        <TabsTrigger value="rlm" disabled={disabled} className="text-xs">
          RLM
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
