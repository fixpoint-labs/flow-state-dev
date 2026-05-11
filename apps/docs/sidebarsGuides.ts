import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  guidesSidebar: [
    "anatomy-of-a-flow",
    "building-a-chat-app",
    "nextjs-setup",
    "development-tips",
    "building-agents",
    "adding-skills-to-your-app",
    "projects-on-org-scope",
    {
      type: "category",
      label: "Deployment",
      items: [
        "deployment",
        "deploying-to-vercel",
        "deploying-to-railway",
        "deploying-with-docker",
        "scheduled-vercel-cron",
        "scheduled-cloud-scheduler",
        "scheduled-eventbridge",
        "scheduled-dynamic",
      ],
    },
  ],
};

export default sidebars;
