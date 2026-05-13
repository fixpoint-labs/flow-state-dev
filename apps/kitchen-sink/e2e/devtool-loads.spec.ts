import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("devtool: embedded panel mounts at /devtool without errors", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId, "/devtool");
  await expect(byTestId(page, "devtool-panel")).toBeVisible();
});
