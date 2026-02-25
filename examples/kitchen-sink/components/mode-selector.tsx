"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ModeSelectorProps {
  mode: "chat" | "plan" | "review";
  onModeChange: (mode: "chat" | "plan" | "review") => void;
  disabled?: boolean;
}

export function ModeSelector({ mode, onModeChange, disabled }: ModeSelectorProps) {
  return (
    <Tabs value={mode} onValueChange={(v) => onModeChange(v as "chat" | "plan" | "review")}>
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
      </TabsList>
    </Tabs>
  );
}
