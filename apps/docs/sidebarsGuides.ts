import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  guidesSidebar: [
    "anatomy-of-a-flow",
    "building-a-chat-app",
    "nextjs-setup",
    "development-tips",
    "building-agents",
    "trading-desk-walkthrough",
    "adding-skills-to-your-app",
    "projects-on-org-scope",
    "writing-ui-stories",
    {
      type: "category",
      label: "Deployment",
      items: [
        "deployment",
        "deploying-to-vercel",
        "deploying-to-railway",
        "deploying-with-docker",
      ],
    },
    {
      type: "category",
      label: "Scheduled actions",
      items: [
        "scheduled-vercel-cron",
        "scheduled-cloud-scheduler",
        "scheduled-eventbridge",
        "scheduled-dynamic",
      ],
    },
  ],
};

export default sidebars;
