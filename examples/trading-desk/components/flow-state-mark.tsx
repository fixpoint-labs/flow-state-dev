import type { ImgHTMLAttributes } from "react";

export type FlowStateMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
  theme: "light" | "dark";
  alt?: string;
};

/** flow-state.dev brand mark — `mark-current` in light mode, `mark-inverse` in dark mode. */
export function FlowStateMark({
  theme,
  alt = "",
  className,
  ...props
}: FlowStateMarkProps) {
  const src =
    theme === "dark" ? "/flow-state/mark-inverse.svg" : "/flow-state/mark-current.svg";

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      decoding="async"
      {...props}
    />
  );
}
