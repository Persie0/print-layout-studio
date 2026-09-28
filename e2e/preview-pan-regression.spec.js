import { expect, test } from "@playwright/test";

test("returning to fit zoom recenters a previously panned sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Arrange your pages" })).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible();

  const stage = page.locator(".paper-stage");
  const sheet = page.locator(".paper-sheet:not(.print-sheet)");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".zoom-level")).toHaveText("125%");

  const stageBox = await stage.boundingBox();
  const beforePan = await sheet.boundingBox();
  const dragX = stageBox.x + stageBox.width / 2;
  const dragY = stageBox.y + stageBox.height / 2;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 40, dragY + 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await sheet.boundingBox()).x).toBeGreaterThan(beforePan.x + 20);

  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.locator(".zoom-level")).toHaveText("100%");
  await expect.poll(async () => {
    const [currentStage, currentSheet] = await Promise.all([stage.boundingBox(), sheet.boundingBox()]);
    const stageCenterX = currentStage.x + currentStage.width / 2;
    const stageCenterY = currentStage.y + currentStage.height / 2;
    const sheetCenterX = currentSheet.x + currentSheet.width / 2;
    const sheetCenterY = currentSheet.y + currentSheet.height / 2;
    return Math.max(Math.abs(stageCenterX - sheetCenterX), Math.abs(stageCenterY - sheetCenterY));
  }).toBeLessThan(2);
});
