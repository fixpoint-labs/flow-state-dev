import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

export function Tabs({ className, ...props }: TabsPrimitive.TabsProps) {
  return <TabsPrimitive.Root className={cn("flex flex-col", className)} {...props} />;
}

export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps) {
  return <TabsPrimitive.List className={cn("inline-flex h-9 items-center rounded-md bg-slate-950 p-1", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium text-slate-400 transition-all hover:text-slate-100 data-[state=active]:bg-slate-800 data-[state=active]:text-slate-100",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: TabsPrimitive.TabsContentProps) {
  return <TabsPrimitive.Content className={cn("mt-2 flex-1", className)} {...props} />;
}
