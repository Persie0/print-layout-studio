import { expect, test } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";

async function makePng(page, width = 32, height = 32) {
  const dataUrl = await page.evaluate(({ imageWidth, imageHeight }) => {
    const canvas = document.createElement("canvas");
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const context = canvas.getContext("2d");
    context.fillStyle = "#2684ff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }, { imageWidth: width, imageHeight: height });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function makeTextPng(page, text, fontSize = 72) {
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
}

async function pastePng(page, name, buffer) {
  await page.locator(".app-shell").evaluate((shell, { filename, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], filename, { type: "image/png" }));
    shell.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, { filename: name, base64: buffer.toString("base64") });
}

async function openStudio(page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Arrange your pages" })).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible();
}

async function saveOcrRatios(page, ratiosByName) {
  await expect.poll(async () => (await readStoredWorkspace(page))?.images?.length ?? 0)
    .toBe(Object.keys(ratiosByName).length);
  await page.evaluate((ratios) => new Promise((resolve, reject) => {
    const open = indexedDB.open("print-layout-studio", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("workspace", "readwrite");
      const store = transaction.objectStore("workspace");
      const request = store.get("active");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const workspace = request.result;
        workspace.images = workspace.images.map((image) => ({
          ...image,
          ocrScanned: true,
          textHeightRatio: ratios[image.name],
        }));
        store.put(workspace);
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), ratiosByName);
}

async function readStoredWorkspace(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("print-layout-studio", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const request = database.transaction("workspace", "readonly").objectStore("workspace").get("active");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        database.close();
        resolve(request.result ?? null);
      };
    };
  }));
}

async function readPrintedTextMm(locator) {
  const text = await locator.textContent();
  const match = text?.match(/([\d.]+) mm/);
  return match ? Number(match[1]) : null;
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
  await expect(page.getByText(/A5 · Auto · portrait · .*2 mm border · 6 mm gap/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Select text block: Keep this complete caption together on page two." })).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Select red-square.png" })).toBeVisible();
  await expect(page.getByLabel("Gap between images in millimeters")).toHaveValue("6");
  await expect(page.getByLabel("Image border width in millimeters")).toHaveValue("2");
  await expect(page.getByText(/A5 · Auto · portrait · .*2 mm border · 6 mm gap/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Page 2" })).toBeVisible();
});

test("real workflow: auto-rotate each sheet for its photos and print both paper orientations", async ({ page }) => {
  await openStudio(page);
  await page.getByLabel("Number of pages").fill("2");

  const landscapePhoto = await makePng(page, 1600, 900);
  await page.getByLabel("Choose images").setInputFiles({
    name: "wide-photo.png",
    mimeType: "image/png",
    buffer: landscapePhoto,
  });

  await page.getByLabel("Page for new items").click();
  await page.getByRole("option", { name: "Page 2" }).click();
  const portraitPhoto = await makePng(page, 900, 1600);
  await page.getByLabel("Choose images").setInputFiles({
    name: "tall-photo.png",
    mimeType: "image/png",
    buffer: portraitPhoto,
  });

  await page.getByRole("tab", { name: "Page 1" }).click();
  await expect(page.getByText(/A4 · Auto · landscape ·/)).toBeVisible();
  const printPageOne = page.locator('.print-sheet[data-page-number="1"]');
  const printPageTwo = page.locator('.print-sheet[data-page-number="2"]');
  await expect(printPageOne).toHaveAttribute("data-orientation", "landscape");
  await expect(printPageTwo).toHaveAttribute("data-orientation", "portrait");
  await expect.poll(() => printPageOne.locator("img").evaluate((image) => [image.naturalWidth, image.naturalHeight])).toEqual([1600, 900]);
  await expect.poll(() => printPageTwo.locator("img").evaluate((image) => [image.naturalWidth, image.naturalHeight])).toEqual([900, 1600]);

  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  const boxes = [...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((match) => ({ width: Number(match[3]) - Number(match[1]), height: Number(match[4]) - Number(match[2]) }));
  expect(boxes).toHaveLength(2);
  expect(boxes[0].width).toBeGreaterThan(boxes[0].height);
  expect(boxes[1].height).toBeGreaterThan(boxes[1].width);
});

test("real workflow: lets users force portrait or landscape and remembers the setting", async ({ page }) => {
  await openStudio(page);

  const previewSheet = page.locator(".paper-sheet:not(.print-sheet)");
  const orientation = page.getByRole("combobox", { name: "Orientation" });
  await orientation.click();
  await page.getByRole("option", { name: "Landscape" }).click();
  await expect(previewSheet).toHaveAttribute("data-orientation", "landscape");
  await expect(page.locator(".preview-spec")).toContainText("Landscape");
  await expect.poll(async () => (await readStoredWorkspace(page))?.orientation).toBe("landscape");

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Orientation" })).toHaveText("Landscape");
  await expect(previewSheet).toHaveAttribute("data-orientation", "landscape");

  await page.getByRole("combobox", { name: "Orientation" }).click();
  await page.getByRole("option", { name: "Portrait" }).click();
  await expect(previewSheet).toHaveAttribute("data-orientation", "portrait");

  await page.getByRole("combobox", { name: "Orientation" }).click();
  await page.getByRole("option", { name: "Auto" }).click();
  await expect(page.getByRole("combobox", { name: "Orientation" })).toContainText("Auto");
});

test("real workflow: group images by border color, persist groups, and enforce the color limit", async ({ page }) => {
  await openStudio(page);
  const firstImage = await makePng(page, 640, 480);
  const secondImage = await makePng(page, 480, 640);
  await page.getByLabel("Choose images").setInputFiles([
    { name: "first-group-image.png", mimeType: "image/png", buffer: firstImage },
    { name: "second-group-image.png", mimeType: "image/png", buffer: secondImage },
  ]);

  await page.getByRole("button", { name: "New image group" }).click();
  await page.getByLabel("Group for first-group-image.png").click();
  await page.getByRole("option", { name: "Group 1" }).click();
  await page.getByRole("button", { name: "New image group" }).click();
  await page.getByLabel("Group for second-group-image.png").click();
  await page.getByRole("option", { name: "Group 2" }).click();

  const firstBorder = page.getByRole("button", { name: "Select image first-group-image.png" });
  const secondBorder = page.getByRole("button", { name: "Select image second-group-image.png" });
  const firstColor = await firstBorder.evaluate((element) => getComputedStyle(element).borderTopColor);
  const secondColor = await secondBorder.evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(firstColor).not.toEqual(secondColor);
  const printedFirstColor = await page.locator('.print-sheet[data-page-number="1"] img[alt="first-group-image.png"]')
    .evaluate((image) => getComputedStyle(image.parentElement).borderTopColor);
  expect(printedFirstColor).toEqual(firstColor);

  await page.waitForTimeout(500);
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Group for first-group-image.png")).toContainText("Group 1");
  await expect(page.getByLabel("Group for second-group-image.png")).toContainText("Group 2");

  for (let count = 2; count < 8; count += 1) {
    await page.getByRole("button", { name: "New image group" }).click();
  }
  await expect(page.getByText("8/8")).toBeVisible();
  await expect(page.getByRole("button", { name: "New image group" })).toBeDisabled();

  await page.getByRole("button", { name: "Delete Group 1" }).click();
  await expect(page.getByLabel("Group for first-group-image.png")).toContainText("No group");
  await expect(page.getByText("7/8")).toBeVisible();
});

test("real workflow: show current printed OCR text size and update it when an image moves pages", async ({ page }) => {
  await openStudio(page);
  await page.getByLabel("Number of pages").fill("2");
  const square = await makePng(page, 900, 900);
  await page.getByLabel("Choose images").setInputFiles([
    { name: "size-one.png", mimeType: "image/png", buffer: square },
    { name: "size-two.png", mimeType: "image/png", buffer: square },
  ]);
  await expect(page.getByRole("button", { name: "Select size-one.png" })).toBeVisible();
  await page.getByText("Saved on this device").waitFor();
  await saveOcrRatios(page, { "size-one.png": 0.05, "size-two.png": 0.05 });

  await page.reload();
  const firstImage = page.locator(".image-item-row").filter({ hasText: "size-one.png" });
  const firstSize = firstImage.locator(".image-text-size");
  await expect(firstSize).toContainText("Printed text ≈");
  await expect(firstImage.getByRole("status", { name: "OCR status for size-one.png" })).toHaveText("OCR ✓");
  const beforeMove = await readPrintedTextMm(firstSize);
  expect(beforeMove).not.toBeNull();

  await page.getByLabel("Page for size-two.png").click();
  await page.getByRole("option", { name: "Page 2" }).click();
  await expect.poll(() => readPrintedTextMm(firstSize)).toBeGreaterThan(beforeMove * 1.2);
});

test("real workflow: render and persist LaTeX math on the print sheet", async ({ page }) => {
  await openStudio(page);
  await page.getByLabel("Text format").click();
  await page.getByRole("option", { name: "LaTeX math" }).click();
  await page.getByLabel("Text block content").fill("$$\\frac{1}{2} + \\sqrt{x^2 + 1} = y$$");
  await page.getByLabel("Type size").fill("24");
  await page.getByRole("button", { name: "Add text block" }).click();
  await expect.poll(async () => (await readStoredWorkspace(page))?.texts?.[0]?.format).toBe("latex");

  const previewMath = page.locator(".paper-sheet:not(.print-sheet) .sheet-text-latex .katex-display");
  await expect(previewMath).toBeVisible();
  await expect(page.locator(".print-sheet .sheet-text-latex .katex-display")).toHaveCount(1);
  await expect(page.locator(".print-sheet .sheet-text-latex annotation[encoding='application/x-tex']"))
    .toContainText("\\frac{1}{2} + \\sqrt{x^2 + 1} = y");

  await page.reload();
  await expect(page.locator(".paper-sheet:not(.print-sheet) .sheet-text-latex .katex-display")).toBeVisible();
  await page.getByRole("button", { name: /Edit text block:/ }).click();
  await expect(page.getByLabel("Text format")).toContainText("LaTeX math");
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  expect(pdf.length).toBeGreaterThan(1000);
});

test("real workflow: fit the whole sheet in the remaining viewport and zoom without inner scrolling", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await openStudio(page);
    const stage = page.locator(".paper-stage");
    const sheet = page.locator(".paper-sheet:not(.print-sheet)");
    await expect(sheet).toBeVisible();
    await expect.poll(async () => {
      const [stageBox, sheetBox] = await Promise.all([stage.boundingBox(), sheet.boundingBox()]);
      return Boolean(stageBox && sheetBox && sheetBox.x >= stageBox.x - 1 && sheetBox.y >= stageBox.y - 1
        && sheetBox.x + sheetBox.width <= stageBox.x + stageBox.width + 1
        && sheetBox.y + sheetBox.height <= stageBox.y + stageBox.height + 1);
    }).toBe(true);
    await expect.poll(() => stage.evaluate((element) => element.scrollHeight <= element.clientHeight
      && element.scrollWidth <= element.clientWidth)).toBe(true);

    const fitBox = await sheet.boundingBox();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => (await sheet.boundingBox()).width).toBeGreaterThan(fitBox.width * 1.1);
    const stageBox = await stage.boundingBox();
    const beforePan = await sheet.boundingBox();
    const dragX = stageBox.x + stageBox.width / 2;
    const dragY = stageBox.y + stageBox.height / 2;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 32, dragY + 24, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await sheet.boundingBox()).x).toBeGreaterThan(beforePan.x + 15);
    await page.getByRole("button", { name: "Fit page" }).click();
    await expect.poll(async () => Math.abs((await sheet.boundingBox()).width - fitBox.width)).toBeLessThan(2);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(async () => (await sheet.boundingBox()).width).toBeLessThan(fitBox.width);
    await page.getByRole("button", { name: "Fit page" }).click();
    await page.goto("about:blank");
  }
});

test("real workflow: show OCR text size on preview images but keep labels out of print", async ({ page }) => {
  await openStudio(page);
  const square = await makePng(page, 900, 900);
  await page.getByLabel("Choose images").setInputFiles({ name: "overlay-size.png", mimeType: "image/png", buffer: square });
  await expect(page.getByRole("button", { name: "Select overlay-size.png" })).toBeVisible();
  await saveOcrRatios(page, { "overlay-size.png": 0.05 });
  await page.reload();

  const previewLabel = page.locator(".paper-sheet:not(.print-sheet) .sheet-ocr-size");
  await expect(previewLabel).toContainText("mm");
  await expect(page.locator(".print-sheet .sheet-ocr-size")).toHaveCount(0);
});

test("real workflow: persist auto OCR on paste and leave file uploads unscanned", async ({ page }) => {
  test.setTimeout(180_000);
  await openStudio(page);
  const autoOcr = page.getByRole("checkbox", { name: "Auto OCR pasted images" });
  await expect(autoOcr).not.toBeChecked();

  const ordinaryImage = await makePng(page);
  await page.getByLabel("Choose images").setInputFiles({ name: "upload-only.png", mimeType: "image/png", buffer: ordinaryImage });
  await expect(page.getByRole("status", { name: "OCR status for upload-only.png" })).toHaveAttribute("data-result", "Not scanned");
  await page.getByRole("button", { name: "Preview full image upload-only.png" }).click();
  await page.keyboard.press("Escape");
  await pastePng(page, "paste-while-off.png", ordinaryImage);
  await expect(page.getByRole("button", { name: "Select paste-while-off.png" })).toBeVisible();
  await expect(page.getByRole("status", { name: "OCR status for paste-while-off.png" })).toHaveAttribute("data-result", "Not scanned");

  await autoOcr.check();
  await expect.poll(async () => (await readStoredWorkspace(page))?.autoOcrOnPaste).toBe(true);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Auto OCR pasted images" })).toBeChecked();
  await expect(page.getByRole("status", { name: "OCR status for upload-only.png" })).toHaveAttribute("data-result", "Not scanned");

  const textImage = await makeTextPng(page, "AUTOPASTE");
  await pastePng(page, "paste-ocr.png", textImage);
  await expect(page.getByRole("button", { name: "Select paste-ocr.png" })).toBeVisible();
  await expect(page.getByRole("status", { name: "OCR status for paste-ocr.png" }))
    .toHaveAttribute("data-result", "Text found", { timeout: 120_000 });
  await expect(page.getByRole("status", { name: "OCR status for upload-only.png" })).toHaveAttribute("data-result", "Not scanned");

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Auto OCR pasted images" })).toBeChecked();
  await expect(page.getByRole("status", { name: "OCR status for paste-ocr.png" })).toHaveAttribute("data-result", "Text found");
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
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await page.getByRole("tab", { name: "Page 1" }).click();
  await expect(page.getByRole("button", { name: "Select move-me.png" })).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.getByText("Saved on this device")).toBeVisible();

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
  await page.waitForTimeout(500);
  await expect(page.getByText("Saved on this device")).toBeVisible();
  const largeOcrStatus = page.getByRole("status", { name: "OCR status for large-copy.png" });
  const smallOcrStatus = page.getByRole("status", { name: "OCR status for small-copy.png" });
  await expect(largeOcrStatus).toHaveAttribute("data-result", "Text found");
  await expect(smallOcrStatus).toHaveAttribute("data-result", "Text found");

  const large = await page.getByRole("button", { name: "Select image large-copy.png" }).boundingBox();
  const small = await page.getByRole("button", { name: "Select image small-copy.png" }).boundingBox();
  expect(small.height).toBeGreaterThan(large.height * 1.5);

  await page.reload();
  await expect(page.getByRole("status", { name: "OCR status for large-copy.png" })).toHaveAttribute("data-result", "Text found");
  await page.getByRole("button", { name: "Match text size" }).click();
  await expect(page.getByRole("alert")).toContainText("All images were already scanned");
  await page.getByRole("button", { name: "Rescan OCR for small-copy.png" }).click();
  await expect(page.getByRole("alert")).toContainText("Rescanned small-copy.png. Text-size data updated.", { timeout: 120_000 });
  await expect(page.getByRole("status", { name: "OCR status for small-copy.png" })).toHaveAttribute("data-result", "Text found");
  await page.waitForTimeout(500);
  await expect(page.getByText("Saved on this device")).toBeVisible();
});
