/**
 * Storybook configuration for `@flow-state-dev/ui`.
 *
 * The Vite builder is extended to:
 *  - register the Tailwind v4 plugin so theme tokens declared in
 *    `preview.css` are picked up at preview time, and
 *  - alias the shadcn `@/components/ui/*` and `@/lib/utils` paths used by
 *    registry components to the preview-only stub directory under
 *    `.storybook/shadcn/`. The registry source remains untouched; the alias
 *    only resolves while Storybook is building.
 */
import type { StorybookConfig } from "@storybook/react-vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../registry/components/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  typescript: { check: false },
  async viteFinal(viteConfig) {
    const tailwindcss = (await import("@tailwindcss/vite")).default;
    viteConfig.plugins ??= [];
    viteConfig.plugins.push(tailwindcss());
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...(viteConfig.resolve.alias ?? {}),
      "@/components/ui": resolve(here, "shadcn/components/ui"),
      "@/lib/utils": resolve(here, "shadcn/lib/utils"),
    };
    return viteConfig;
  },
};

export default config;
