import type { ImgHTMLAttributes } from "react";

const markCurrentUrl = new URL("../../assets/mark-current.svg", import.meta.url).href;
const markInverseUrl = new URL("../../assets/mark-inverse.svg", import.meta.url).href;

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
  const src = theme === "dark" ? markInverseUrl : markCurrentUrl;

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
