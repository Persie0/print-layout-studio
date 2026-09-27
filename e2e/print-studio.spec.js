import { expect, test } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";

async function makePng(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    context.fillStyle = "#2684ff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function openStudio(page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Arrange your pages" })).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible();
}

test("real workflow: add page items, adjust print settings, and restore them after reload", async ({ page }) => {
  await openStudio(page);
  const png = await makePng(page);
  await page.getByLabel("Choose images").setInputFiles({ name: "red-square.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("button", { name: "Select red-square.png" })).toBeVisible();

  await page.getByLabel("Number of pages").fill("2");
  await page.getByLabel("Gap between images in millimeters").fill("6");
  await page.getByLabel("Image border width in millimeters").fill("2");
  await page.getByRole("combobox", { name: "Paper format" }).click();
  await page.getByRole("option", { name: "A5" }).click();
  await page.getByLabel("Page for new items").click();
  await page.getByRole("option", { name: "Page 2" }).last().click();

  await page.getByLabel("Text block content").fill("Keep this complete caption together on page two.");
  await page.getByLabel("Type size").fill("18");
  await page.getByRole("button", { name: "Add text block" }).click();
  await expect(page.getByRole("tab", { name: "Page 2" })).toBeVisible();
  await expect(page.getByText(/A5 · portrait · .*2 mm border · 6 mm gap/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Select text block: Keep this complete caption together on page two." })).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Select red-square.png" })).toBeVisible();
  await expect(page.getByLabel("Gap between images in millimeters")).toHaveValue("6");
  await expect(page.getByLabel("Image border width in millimeters")).toHaveValue("2");
  await expect(page.getByText(/A5 · portrait · .*2 mm border · 6 mm gap/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Page 2" })).toBeVisible();
});

test("real workflow: delete an image and keep it deleted after reload", async ({ page }) => {
  await openStudio(page);
  const png = await makePng(page);
  await page.getByLabel("Choose images").setInputFiles({ name: "remove-me.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("button", { name: "Select remove-me.png" })).toBeVisible();
  await page.getByRole("button", { name: "Remove remove-me.png" }).click();
  await expect(page.getByRole("button", { name: "Select remove-me.png" })).toHaveCount(0);
  await expect(page.getByText("Items added to this page will appear here.")).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Select remove-me.png" })).toHaveCount(0);
  await expect(page.getByText("Items added to this page will appear here.")).toBeVisible();
});

test("real workflow: move an image to another page and restore the assignment after reload", async ({ page }) => {
  await openStudio(page);
  const png = await makePng(page);
  await page.getByLabel("Choose images").setInputFiles({ name: "move-me.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Number of pages").fill("2");
  await page.getByLabel("Page for move-me.png").click();
  await page.getByRole("option", { name: "Page 2" }).click();
  await page.getByRole("tab", { name: "Page 2" }).click();
  await expect(page.getByRole("button", { name: "Select move-me.png" })).toBeVisible();
  await expect(page.getByText("Page 2 items")).toBeVisible();
  await page.getByRole("tab", { name: "Page 1" }).click();
  await expect(page.getByRole("button", { name: "Select move-me.png" })).toHaveCount(0);

  await page.reload();
  await page.getByRole("tab", { name: "Page 2" }).click();
  await expect(page.getByRole("button", { name: "Select move-me.png" })).toBeVisible();
  await expect(page.getByLabel("Page for move-me.png")).toContainText("Page 2");
});

test("real workflow: import Page folders, then download a ZIP with those folders", async ({ page }) => {
  await openStudio(page);
  const png = await makePng(page);
  const archive = zipSync({
    "Page 1/first.png": png,
    "Page 2/second.png": png,
    "Page 3/": new Uint8Array(),
  });
  await page.getByLabel("Import page ZIP").setInputFiles({
    name: "print-pages.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });
  await expect(page.getByRole("button", { name: "Select first.png" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Page 3" })).toBeVisible();
  await page.getByRole("tab", { name: "Page 1" }).click();
  await expect(page.getByRole("button", { name: "Select first.png" })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download pages as ZIP" }).click(),
  ]);
  const bytes = await download.createReadStream().then(async (stream) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  });
  const entries = unzipSync(bytes);
  expect(Object.keys(entries).sort()).toEqual([
    "Page 1/",
    "Page 1/first.png",
    "Page 2/",
    "Page 2/second.png",
    "Page 3/",
  ]);
});

test("real workflow: preview the original image in a full-resolution popover", async ({ page }) => {
  await openStudio(page);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    context.fillStyle = "#2684ff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  });
  const image = Buffer.from(dataUrl.split(",")[1], "base64");
  await page.getByLabel("Choose images").setInputFiles({
    name: "original-size.png",
    mimeType: "image/png",
    buffer: image,
  });

  await page.getByRole("button", { name: "Preview full image original-size.png" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "original-size.png" })).toBeVisible();
  const fullImage = dialog.getByRole("img", { name: "original-size.png" });
  await expect(fullImage).toBeVisible();
  await expect.poll(() => fullImage.evaluate((element) => [element.naturalWidth, element.naturalHeight])).toEqual([640, 480]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Select original-size.png" }).click();
  await expect(page.getByRole("button", { name: "Select image original-size.png" })).toBeVisible();
});

test("real workflow: OCR text and resize images to match their printed letter height", async ({ page }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  const png = await makePng(page);
  const makeTextImage = async (text, fontSize) => {
    const dataUrl = await page.evaluate(({ content, size }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 240;
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111";
      context.font = `bold ${size}px Arial`;
      context.fillText(content, 24, 160);
      return canvas.toDataURL("image/png");
    }, { content: text, size: fontSize });
    return Buffer.from(dataUrl.split(",")[1], "base64");
  };
  await page.getByLabel("Choose images").setInputFiles([
    { name: "large-copy.png", mimeType: "image/png", buffer: await makeTextImage("LARGE", 80) },
    { name: "small-copy.png", mimeType: "image/png", buffer: await makeTextImage("SMALL", 24) },
  ]);
  await expect(page.getByRole("button", { name: "Select image large-copy.png" })).toBeVisible();
  await page.getByRole("button", { name: "Match text size" }).click();
  await expect(page.getByRole("alert")).toContainText("Matched text size in 2 of 2 images.", { timeout: 120_000 });
  const largeOcrStatus = page.getByRole("status", { name: "OCR status for large-copy.png" });
  const smallOcrStatus = page.getByRole("status", { name: "OCR status for small-copy.png" });
  await expect(largeOcrStatus).toHaveText("Text found");
  await expect(smallOcrStatus).toHaveText("Text found");

  const large = await page.getByRole("button", { name: "Select image large-copy.png" }).boundingBox();
  const small = await page.getByRole("button", { name: "Select image small-copy.png" }).boundingBox();
  expect(small.height).toBeGreaterThan(large.height * 1.5);

  await page.reload();
  await expect(page.getByRole("status", { name: "OCR status for large-copy.png" })).toHaveText("Text found");
  await page.getByRole("button", { name: "Match text size" }).click();
  await expect(page.getByRole("alert")).toContainText("All images were already scanned");
  await page.getByRole("button", { name: "Rescan OCR for small-copy.png" }).click();
  await expect(page.getByRole("alert")).toContainText("Rescanned small-copy.png. Text-size data updated.", { timeout: 120_000 });
  await expect(page.getByRole("status", { name: "OCR status for small-copy.png" })).toHaveText("Text found");
});
