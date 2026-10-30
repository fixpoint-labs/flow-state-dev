import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "../lib/theme";

/** The sidebar's theme mark. It names the look a press moves to. */
export function ThemeToggle() {
  const [theme, choose] = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => choose(dark ? "light" : "dark")}
      className="flex items-center gap-1.5 border border-transparent px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase hover:bg-accent hover:text-foreground"
    >
      {dark ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
      {dark ? "Light" : "Dark"}
    </button>
  );
}
