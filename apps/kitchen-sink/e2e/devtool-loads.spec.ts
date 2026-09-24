import { test, expect, byTestId } from "./fixtures";

test("devtool: embedded panel mounts at /devtool without errors", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  await page.goto("/devtool");
  await expect(byTestId(page, "devtool-panel")).toBeVisible();
});
