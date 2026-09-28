import { expect, test } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { inflateSync } from "node:zlib";

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

async function readPageAverageMm(page, pageNumber) {
  await page.getByRole("tab", { name: `Page ${pageNumber}` }).click();
  const text = await page.locator(".preview-average").textContent();
  const match = text?.match(/≈\s*([\d.]+) mm/);
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

test("real workflow: adding a page switches the workspace to the new page", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Add one page" }).click();
  await expect(page.getByRole("tab", { name: "Page 2" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Page 2 items" })).toBeVisible();
  await expect(page.getByLabel("Page for new items")).toContainText("Page 2");
});

test("real workflow: Control or Command Z undoes pasted image batches", async ({ page }) => {
  await openStudio(page);
  const png = await makePng(page, 64, 48);
  await pastePng(page, "first-paste.png", png);
  await expect(page.getByRole("button", { name: "Select first-paste.png" })).toBeVisible();
  await pastePng(page, "second-paste.png", png);
  await expect(page.getByRole("button", { name: "Select second-paste.png" })).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: "Select second-paste.png" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select first-paste.png" })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: "Select first-paste.png" })).toHaveCount(0);
  await expect.poll(async () => (await readStoredWorkspace(page))?.images?.length).toBe(0);
});

test("real workflow: show the disabled text action with readable contrast", async ({ page }) => {
  await openStudio(page);
  const addText = page.getByRole("button", { name: "Add text block" });
  await expect(addText).toBeDisabled();
  const colors = await addText.evaluate((button) => {
    const style = getComputedStyle(button);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(colors).toEqual({ foreground: "rgb(97, 114, 118)", background: "rgb(228, 234, 231)" });
});

test("real workflow: auto-size typed text with image OCR and keep it linked after reload", async ({ page }) => {
  await openStudio(page);
  const png = await makePng(page, 900, 900);
  await page.getByLabel("Choose images").setInputFiles({ name: "text-size-reference.png", mimeType: "image/png", buffer: png });
  await saveOcrRatios(page, { "text-size-reference.png": 0.05 });
  await page.reload();
  await expect(page.getByText("Saved on this device")).toBeVisible();

  const autoSize = page.getByRole("checkbox", { name: "Auto-size typed text to detected image text" });
  await expect(autoSize).toBeChecked();
  const typeSize = page.getByLabel("Type size");
  await expect(typeSize).toHaveAttribute("readonly", "");
  const matchedSize = Number(await typeSize.inputValue());
  expect(matchedSize).toBeGreaterThan(8);
  expect(matchedSize).toBeLessThan(72);
  const adjustment = page.getByLabel("Adjust text size from image percent");
  await adjustment.fill("20");
  const adjustedSize = Math.round(matchedSize * 1.2);
  await expect(typeSize).toHaveValue(String(Math.min(72, adjustedSize)));
  await adjustment.fill("-10");
  const smallerSize = Math.round(matchedSize * 0.9);
  await expect(typeSize).toHaveValue(String(Math.max(8, smallerSize)));

  await page.getByLabel("Text block content").fill("Text sized to match the image");
  await page.getByRole("button", { name: "Add text block" }).click();
  await expect.poll(async () => (await readStoredWorkspace(page))?.texts?.[0]?.fontSize).toBe(Math.max(8, smallerSize));
  await expect.poll(async () => (await readStoredWorkspace(page))?.texts?.[0]?.autoSize).toBe(true);
  const renderedAutoText = page.locator(".paper-sheet:not(.print-sheet) .sheet-text");
  const originalRenderedSize = await renderedAutoText.evaluate((text) => Number.parseFloat(getComputedStyle(text).fontSize));
  const originalOcrAverage = await readPrintedTextMm(page.locator(".preview-average"));
  const selectedTextColors = await renderedAutoText.evaluate((text) => ({
    background: getComputedStyle(text).backgroundColor,
    borderColor: getComputedStyle(text).borderTopColor,
  }));
  expect(selectedTextColors.background).toBe("rgba(0, 0, 0, 0)");
  expect(selectedTextColors.borderColor).not.toBe("rgba(0, 0, 0, 0)");

  await saveOcrRatios(page, { "text-size-reference.png": 0.1 });
  await page.reload();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  const resizedAutoText = page.locator(".paper-sheet:not(.print-sheet) .sheet-text");
  await expect.poll(async () => Number.parseFloat(await resizedAutoText.evaluate((text) => getComputedStyle(text).fontSize)))
    .toBeGreaterThan(originalRenderedSize * 1.05);
  expect(await readPrintedTextMm(page.locator(".preview-average"))).toBeGreaterThan(originalOcrAverage);

  await autoSize.uncheck();
  await expect(typeSize).not.toHaveAttribute("readonly", "");
});

test("real workflow: remove an image from the full-resolution viewer", async ({ page }) => {
  await openStudio(page);
  const png = await makePng(page, 100, 60);
  await page.getByLabel("Choose images").setInputFiles({ name: "remove-from-viewer.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Preview full image remove-from-viewer.png" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Remove remove-from-viewer.png" })).toBeVisible();
  await dialog.getByRole("button", { name: "Remove remove-from-viewer.png" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Select remove-from-viewer.png" })).toHaveCount(0);
});

test("real workflow: show the image's sheet and paper details in its full-resolution viewer", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Add one page" }).click();
  const png = await makePng(page, 100, 60);
  await page.getByLabel("Choose images").setInputFiles({ name: "page-information.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Preview full image page-information.png" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Page 2 · A4 · (Portrait|Landscape)/)).toBeVisible();
});

test("real workflow: hide the page setup bars and bring them back from the sheet view", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Hide top bars" }).click();
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".paper-toolbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print pages" })).toBeVisible();

  await page.getByRole("button", { name: "Show again" }).click();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".paper-toolbar")).toBeVisible();
});

test("real workflow: auto orientation is per-sheet but printed pages all use portrait paper", async ({ page }) => {
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

  await page.emulateMedia({ media: "print" });
  const rotatedSheetTransform = await printPageOne.evaluate((sheet) => getComputedStyle(sheet).transform);
  expect(rotatedSheetTransform).not.toBe("none");
  const printLayout = await page.locator(".print-page").evaluateAll((sheets) => sheets.map((sheet) => {
    const style = getComputedStyle(sheet);
    const rect = sheet.getBoundingClientRect();
    return { width: rect.width, height: rect.height, breakAfter: style.breakAfter, page: style.page };
  }));
  const printDocumentLayout = await page.locator(".print-document").evaluate((documentNode) => {
    const rect = documentNode.getBoundingClientRect();
    return { width: rect.width, height: rect.height, childCount: documentNode.children.length };
  });
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: "screen" });
  const pdfText = pdf.toString("latin1");
  const pageObjectCount = [...pdfText.matchAll(/\/Type\s*\/Page\b/g)].length;
  const pageObjects = [...pdfText.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)]
    .filter((match) => /\/Type\s*\/Page\b/.test(match[2]))
    .map((match) => ({
      id: match[1],
      mediaBox: match[2].match(/\/MediaBox\s*\[([^\]]+)\]/)?.[1],
      contents: match[2].match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/)?.[1],
    }));
  const pageStreams = pageObjects.map((pageObject) => {
    const contentId = pageObject.contents?.match(/^(\d+)/)?.[1];
    if (!contentId) return { pageId: pageObject.id, streamBytes: null, drawOperations: null };
    const objectStart = pdfText.indexOf(`${contentId} 0 obj`);
    const objectEnd = pdfText.indexOf("endobj", objectStart);
    const objectHeader = pdfText.slice(objectStart, objectEnd);
    const streamStartMatch = objectHeader.match(/stream\r?\n/);
    const length = Number(objectHeader.match(/\/Length\s+(\d+)/)?.[1]);
    if (!streamStartMatch || !Number.isFinite(length)) return { pageId: pageObject.id, streamBytes: null, drawOperations: null };
    const byteStart = objectStart + streamStartMatch.index + streamStartMatch[0].length;
    const encoded = pdf.subarray(byteStart, byteStart + length);
    let decoded = encoded;
    if (/\/FlateDecode\b/.test(objectHeader)) {
      try { decoded = inflateSync(encoded); } catch { /* Keep the encoded stream in the diagnostics. */ }
    }
    const operations = decoded.toString("latin1");
    return {
      pageId: pageObject.id,
      streamBytes: length,
      decodedBytes: decoded.length,
      drawOperations: (operations.match(/\/[A-Za-z0-9]+\s+Do\b/g) ?? []).length,
      snippet: operations.slice(0, 90),
    };
  });
  console.log("print-pdf-debug", JSON.stringify({ pageObjectCount, pageObjects, pageStreams, printLayout, printDocumentLayout }));
  expect(pageObjectCount).toBe(2);
  const boxes = [...pdfText.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((match) => ({ width: Number(match[3]) - Number(match[1]), height: Number(match[4]) - Number(match[2]) }));
  expect(boxes.length).toBeGreaterThanOrEqual(2);
  expect(boxes.every((box) => box.height > box.width)).toBe(true);
  expect(boxes.every((box) => Math.abs(box.width - boxes[0].width) < 0.1 && Math.abs(box.height - boxes[0].height) < 0.1)).toBe(true);
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

test("real workflow: export a complete workspace and import it in a fresh browser profile", async ({ page, browser }) => {
  await openStudio(page);
  const png = await makePng(page, 640, 480);
  await page.getByLabel("Choose images").setInputFiles({ name: "portable-scan.png", mimeType: "image/png", buffer: png });
  await saveOcrRatios(page, { "portable-scan.png": 0.05 });
  await page.reload();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await page.getByRole("button", { name: "New image group" }).click();
  await expect(page.getByText("1/8")).toBeVisible();
  const imageGroup = page.getByLabel("Group for portable-scan.png");
  await imageGroup.click();
  await page.getByRole("option", { name: "Group 1" }).click();
  await expect(imageGroup).toContainText("Group 1");
  await page.getByLabel("Automatically match image text sizes").uncheck();
  await page.getByLabel("Auto OCR pasted images").check();
  await page.getByLabel("Number of pages").fill("2");
  await page.getByLabel("Gap between images in millimeters").fill("4");
  await page.getByLabel("Image border width in millimeters").fill("2");
  await page.getByRole("combobox", { name: "Paper format" }).click();
  await page.getByRole("option", { name: "A5" }).click();
  await page.getByRole("combobox", { name: "Orientation" }).click();
  await page.getByRole("option", { name: "Landscape" }).click();
  await page.getByLabel("Text block content").fill("Portable caption");
  await page.getByRole("button", { name: "Add text block" }).click();
  await expect.poll(async () => (await readStoredWorkspace(page))?.texts?.[0]?.autoSize).toBe(true);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export workspace" }).click(),
  ]);
  const exportPath = await download.path();
  expect(download.suggestedFilename()).toBe("print-layout-workspace.zip");

  const restoreContext = await browser.newContext();
  try {
    const restorePage = await restoreContext.newPage();
    await openStudio(restorePage);
    await restorePage.getByLabel("Import workspace ZIP").setInputFiles(exportPath);
    await expect(restorePage.getByLabel("Gap between images in millimeters")).toHaveValue("4");
    await expect(restorePage.getByLabel("Image border width in millimeters")).toHaveValue("2");
    await expect(restorePage.getByRole("combobox", { name: "Paper format" })).toContainText("A5");
    await expect(restorePage.getByRole("combobox", { name: "Orientation" })).toContainText("Landscape");
    await expect(restorePage.getByRole("tab", { name: "Page 2" })).toBeVisible();
    await expect(restorePage.getByRole("button", { name: "Select portable-scan.png" })).toBeVisible();
    await expect(restorePage.getByRole("button", { name: /Edit text block: Portable caption/ })).toBeVisible();
    await expect(restorePage.getByRole("checkbox", { name: "Automatically match image text sizes" })).not.toBeChecked();
    await expect(restorePage.getByRole("checkbox", { name: "Auto OCR pasted images" })).toBeChecked();
    await expect.poll(async () => (await readStoredWorkspace(restorePage))?.groups?.length ?? 0).toBe(1);
    const restored = await readStoredWorkspace(restorePage);
    expect(restored.images[0]).toMatchObject({ ocrScanned: true, textHeightRatio: 0.05, groupId: restored.groups[0].id });
    expect(restored.texts[0]).toMatchObject({ content: "Portable caption", autoSize: true });
    await expect(restorePage.getByText("Saved on this device")).toBeVisible();
  } finally {
    await restoreContext.close();
  }
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
  await page.getByRole("checkbox", { name: "Print small numbers on Group 1 images" }).check();
  await expect(page.getByRole("checkbox", { name: "Print small numbers on Group 1 images" })).toBeChecked();
  await expect(page.locator(".paper-sheet:not(.print-sheet) .sheet-image-number")).toHaveText("1");
  await expect(page.locator('.print-sheet[data-page-number="1"] .sheet-image-number')).toHaveText("1");

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
  await expect(page.getByRole("checkbox", { name: "Print small numbers on Group 1 images" })).toBeChecked();

  for (let count = 2; count < 8; count += 1) {
    await page.getByRole("button", { name: "New image group" }).click();
  }
  await expect(page.getByText("8/8")).toBeVisible();
  await expect(page.getByRole("button", { name: "New image group" })).toBeDisabled();

  await page.getByRole("button", { name: "Delete Group 1" }).click();
  await expect(page.getByLabel("Group for first-group-image.png")).toContainText("No group");
  await expect(page.getByText("7/8")).toBeVisible();
});

test("real workflow: print sequential small numbers on every image in a group", async ({ page }) => {
  await openStudio(page);
  const png = await makePng(page, 640, 480);
  const names = ["number-one.png", "number-two.png", "number-three.png", "number-four.png"];
  await page.getByLabel("Choose images").setInputFiles(names.map((name) => ({ name, mimeType: "image/png", buffer: png })));
  await page.getByRole("button", { name: "New image group" }).click();
  await expect(page.getByText("1/8")).toBeVisible();
  for (const name of names) {
    const imageGroup = page.getByLabel(`Group for ${name}`);
    await imageGroup.click();
    await page.getByRole("option", { name: "Group 1" }).click();
    await expect(imageGroup).toContainText("Group 1");
  }

  const numbering = page.getByRole("checkbox", { name: "Print small numbers on Group 1 images" });
  await numbering.check();
  await expect(numbering).toBeChecked();
  await expect.poll(async () => (await readStoredWorkspace(page))?.groups?.[0]?.numberImages).toBe(true);
  await expect(page.locator(".paper-sheet:not(.print-sheet) .sheet-image-number")).toHaveText(["1", "2", "3", "4"]);
  await expect(page.locator('.print-sheet[data-page-number="1"] .sheet-image-number')).toHaveText(["1", "2", "3", "4"]);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Print small numbers on Group 1 images" })).toBeChecked();
  await expect(page.locator('.print-sheet[data-page-number="1"] .sheet-image-number')).toHaveText(["1", "2", "3", "4"]);
  await expect(page.getByText("Saved on this device")).toBeVisible();
});

test("real workflow: balance selected pages by moving a group into a new numbered group", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("checkbox", { name: "Automatically match image text sizes" }).uncheck();
  const square = await makePng(page, 640, 640);
  const pageOneNames = ["balance-p1-a.png", "balance-p1-b.png", "balance-p1-c.png"];
  await page.getByLabel("Choose images").setInputFiles(pageOneNames.map((name) => ({ name, mimeType: "image/png", buffer: square })));
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "New image group" }).click();
    await expect(page.getByText(`${index + 1}/8`)).toBeVisible();
  }
  for (const [index, name] of pageOneNames.entries()) {
    const groupSelect = page.getByLabel(`Group for ${name}`);
    await groupSelect.click();
    await page.getByRole("option", { name: `Group ${index + 1}` }).click();
    await expect(groupSelect).toContainText(`Group ${index + 1}`);
  }

  await page.getByRole("checkbox", { name: "Print small numbers on Group 2 images" }).check();
  await page.getByRole("button", { name: "Add one page" }).click();
  const pageTwoNames = ["balance-p2-a.png", "balance-p2-b.png", "balance-p2-c.png"];
  await page.getByLabel("Choose images").setInputFiles(pageTwoNames.map((name) => ({ name, mimeType: "image/png", buffer: square })));
  for (const [index, name] of pageTwoNames.entries()) {
    const groupSelect = page.getByLabel(`Group for ${name}`);
    await groupSelect.click();
    await page.getByRole("option", { name: index === 0 ? "Group 1" : "Group 2" }).click();
    await expect(groupSelect).toContainText(index === 0 ? "Group 1" : "Group 2");
  }
  await expect.poll(async () => {
    const workspace = await readStoredWorkspace(page);
    const groupsById = new Map(workspace?.groups.map((group) => [group.id, group.name]));
    return pageOneNames.concat(pageTwoNames).map((name) => {
      const image = workspace?.images.find((candidate) => candidate.name === name);
      return image ? groupsById.get(image.groupId) : null;
    });
  }).toEqual(["Group 1", "Group 2", "Group 3", "Group 1", "Group 2", "Group 2"]);

  await saveOcrRatios(page, {
    "balance-p1-a.png": 0.01,
    "balance-p1-b.png": 0.01,
    "balance-p1-c.png": 0.01,
    "balance-p2-a.png": 0.03,
    "balance-p2-b.png": 0.09,
    "balance-p2-c.png": 0.09,
  });
  await page.reload();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Page scope for balancing" })).toContainText("All pages");
  await page.getByRole("combobox", { name: "Page scope for balancing" }).click();
  await page.getByRole("option", { name: "Selected pages" }).click();
  await page.getByRole("button", { name: "Choose pages to balance" }).click();
  const balanceButton = page.getByRole("button", { name: "Balance pages" });
  await expect(balanceButton).toBeDisabled();
  const includePageTwo = page.getByRole("checkbox", { name: "Include Page 2 in balancing" });
  await includePageTwo.check();
  await expect(includePageTwo).toBeChecked();
  await expect(balanceButton).toBeEnabled();

  const pageOneBefore = await readPageAverageMm(page, 1);
  const pageTwoBefore = await readPageAverageMm(page, 2);
  expect(pageOneBefore).not.toBeNull();
  expect(pageTwoBefore).not.toBeNull();
  const workspaceBefore = await readStoredWorkspace(page);
  const originalGroupTwo = workspaceBefore.groups.find((group) => group.name === "Group 2");
  const imagesToMove = workspaceBefore.images.filter((image) => image.page === 2 && image.groupId === originalGroupTwo.id);
  expect(imagesToMove).toHaveLength(2);

  await balanceButton.click();
  await expect(page.getByRole("status", { name: "Page balance result" })).toContainText("Group 4");
  await expect.poll(async () => {
    const workspace = await readStoredWorkspace(page);
    return workspace?.images.filter((image) => imagesToMove.some((moved) => moved.id === image.id && image.page === 1)).length;
  }).toBe(2);

  const workspaceAfter = await readStoredWorkspace(page);
  const movedGroup = workspaceAfter.groups.find((group) => group.name === "Group 4");
  expect(movedGroup).toBeTruthy();
  expect(movedGroup.numberImages).toBe(true);
  const movedImagesAfter = workspaceAfter.images.filter((image) => imagesToMove.some((moved) => moved.id === image.id));
  expect(movedImagesAfter).toHaveLength(2);
  expect(movedImagesAfter.every((image) => image.page === 1 && image.groupId === movedGroup.id)).toBe(true);
  expect(workspaceAfter.images.find((image) => image.name === "balance-p1-b.png").groupId).toBe(originalGroupTwo.id);
  const movedImageOneNumber = page.locator('.print-sheet[data-page-number="1"] img[alt="balance-p2-b.png"]')
    .locator("xpath=..").locator(".sheet-image-number");
  const movedImageTwoNumber = page.locator('.print-sheet[data-page-number="1"] img[alt="balance-p2-c.png"]')
    .locator("xpath=..").locator(".sheet-image-number");
  await expect(movedImageOneNumber).toHaveText("1");
  await expect(movedImageTwoNumber).toHaveText("2");

  const pageOneAfter = await readPageAverageMm(page, 1);
  const pageTwoAfter = await readPageAverageMm(page, 2);
  const oldDifference = Math.abs(pageOneBefore - pageTwoBefore);
  const newDifference = Math.abs(pageOneAfter - pageTwoAfter);
  expect(newDifference).toBeLessThan(oldDifference);
  for (const average of [pageOneAfter, pageTwoAfter]) {
    expect(average).toBeGreaterThanOrEqual(Math.min(pageOneBefore, pageTwoBefore) - 0.1);
    expect(average).toBeLessThanOrEqual(Math.max(pageOneBefore, pageTwoBefore) + 0.1);
  }
});

test("real workflow: retain a group's number when balancing moves it intact to another page", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("checkbox", { name: "Automatically match image text sizes" }).uncheck();
  const square = await makePng(page, 900, 900);
  await page.getByLabel("Choose images").setInputFiles({ name: "reuse-page-one.png", mimeType: "image/png", buffer: square });
  await page.getByRole("button", { name: "New image group" }).click();
  await expect(page.getByText("1/8")).toBeVisible();
  await page.getByLabel("Group for reuse-page-one.png").click();
  await page.getByRole("option", { name: "Group 1" }).click();
  await expect(page.getByLabel("Group for reuse-page-one.png")).toContainText("Group 1");
  await page.getByRole("button", { name: "Add one page" }).click();
  await page.getByLabel("Choose images").setInputFiles([
    { name: "reuse-moving-a.png", mimeType: "image/png", buffer: square },
    { name: "reuse-moving-b.png", mimeType: "image/png", buffer: square },
    { name: "reuse-staying-a.png", mimeType: "image/png", buffer: square },
    { name: "reuse-staying-b.png", mimeType: "image/png", buffer: square },
  ]);
  await page.getByRole("button", { name: "New image group" }).click();
  await expect(page.getByText("2/8")).toBeVisible();
  for (const name of ["reuse-moving-a.png", "reuse-moving-b.png"]) {
    const groupSelect = page.getByLabel(`Group for ${name}`);
    await groupSelect.click();
    await page.getByRole("option", { name: "Group 2" }).click();
    await expect(groupSelect).toContainText("Group 2");
  }
  await page.getByRole("button", { name: "New image group" }).click();
  await expect(page.getByText("3/8")).toBeVisible();
  for (const name of ["reuse-staying-a.png", "reuse-staying-b.png"]) {
    const groupSelect = page.getByLabel(`Group for ${name}`);
    await groupSelect.click();
    await page.getByRole("option", { name: "Group 3" }).click();
    await expect(groupSelect).toContainText("Group 3");
  }
  await expect.poll(async () => {
    const workspace = await readStoredWorkspace(page);
    const groupsById = new Map(workspace?.groups.map((group) => [group.id, group.name]));
    return ["reuse-page-one.png", "reuse-moving-a.png", "reuse-moving-b.png", "reuse-staying-a.png", "reuse-staying-b.png"]
      .map((name) => {
        const image = workspace?.images.find((candidate) => candidate.name === name);
        return image ? groupsById.get(image.groupId) : null;
      });
  }).toEqual(["Group 1", "Group 2", "Group 2", "Group 3", "Group 3"]);
  await saveOcrRatios(page, {
    "reuse-page-one.png": 0.005,
    "reuse-moving-a.png": 0.05,
    "reuse-moving-b.png": 0.05,
    "reuse-staying-a.png": 0.02,
    "reuse-staying-b.png": 0.02,
  });
  await page.reload();
  await expect(page.getByText("Saved on this device")).toBeVisible();

  const balanceButton = page.getByRole("button", { name: "Balance pages" });
  await expect(balanceButton).toBeEnabled();
  const workspaceBefore = await readStoredWorkspace(page);
  await balanceButton.click();
  const moveText = await page.getByRole("status", { name: "Page balance result" }).textContent();
  const reusableMove = [...(moveText ?? "").matchAll(/(Group [23]) Page 2 → (Group [23]) Page 1/g)]
    .find((match) => match[1] === match[2]);
  expect(reusableMove).toBeTruthy();
  const movedSourceGroup = workspaceBefore.groups.find((group) => group.name === reusableMove?.[1]);
  const imageIdsToMove = workspaceBefore.images
    .filter((image) => image.page === 2 && image.groupId === movedSourceGroup?.id)
    .map((image) => image.id);
  await expect.poll(async () => {
    const workspace = await readStoredWorkspace(page);
    return workspace?.images.filter((image) => imageIdsToMove.includes(image.id))
      .map((image) => ({ page: image.page, groupId: image.groupId }));
  }).toEqual(imageIdsToMove.map(() => ({ page: 1, groupId: movedSourceGroup?.id })));
  const workspaceAfter = await readStoredWorkspace(page);
  const resultingGroup = workspaceAfter.groups.find((group) => group.name === reusableMove?.[2]);
  expect(movedSourceGroup).toBeTruthy();
  expect(resultingGroup?.id).toBe(movedSourceGroup?.id);
  expect(imageIdsToMove).toHaveLength(2);
  const imageIdsToMoveSet = new Set(imageIdsToMove);
  const movedImages = workspaceAfter.images.filter((image) => imageIdsToMoveSet.has(image.id));
  expect(movedImages).toHaveLength(2);
  expect(movedImages.every((image) => image.page === 1 && image.groupId === movedSourceGroup?.id)).toBe(true);
  expect(workspaceAfter.groups.map((group) => group.name)).toEqual(["Group 1", "Group 2", "Group 3"]);
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

test("real workflow: render ChatGPT Markdown tables and arrange blank-line sections separately", async ({ page }) => {
  await openStudio(page);
  const addText = page.getByRole("button", { name: "Add text block" });
  await expect(addText).toBeDisabled();
  await expect(addText).toHaveCSS("background-color", "rgb(228, 234, 231)");
  await expect(addText).toHaveCSS("color", "rgb(97, 114, 118)");

  await page.getByLabel("Text block content").fill([
    "## Logical forms",
    "",
    "| English wording | Logical form | Important note |",
    "| --- | --- | --- |",
    "| **P and Q** | \\(P\\land Q\\) | both true |",
    "| P only if Q | $P\\to Q$ | scope matters |",
    "",
    "Raw HTML stays text: <img src=x onerror=alert(1)>",
  ].join("\n"));
  await page.getByLabel("Text format").click();
  await page.getByRole("option", { name: "Markdown / ChatGPT answer" }).click();
  await page.getByRole("checkbox", { name: "Split text at blank lines" }).check();
  await page.getByRole("button", { name: "Add text block" }).click();

  await expect.poll(async () => (await readStoredWorkspace(page))?.texts?.length).toBe(3);
  await expect.poll(async () => (await readStoredWorkspace(page))?.texts?.every((text) => text.format === "markdown")).toBe(true);
  const sheetBlocks = page.locator(".paper-sheet:not(.print-sheet) .sheet-text-markdown");
  await expect(sheetBlocks).toHaveCount(3);
  const tableBlock = sheetBlocks.filter({ has: page.locator("table") });
  await expect(tableBlock.locator("th")).toHaveCount(3);
  await expect(tableBlock.locator("strong")).toHaveText("P and Q");
  await expect(tableBlock.locator(".katex")).toHaveCount(2);
  await expect(tableBlock).toContainText("scope matters");
  const escapedHtmlBlock = sheetBlocks.filter({ hasText: "Raw HTML stays text" });
  await expect(escapedHtmlBlock).toHaveCount(1);
  await expect(escapedHtmlBlock.locator("img")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".paper-sheet:not(.print-sheet) .sheet-text-markdown table")).toBeVisible();
});

test("real workflow: fit the whole sheet in the remaining viewport and zoom without inner scrolling", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await openStudio(page);
    const stage = page.locator(".paper-stage");
    const previewPanel = page.locator(".preview-panel");
    const sheet = page.locator(".paper-sheet:not(.print-sheet)");
    await expect(page.locator(".zoom-level")).toHaveText("100%");
    await expect(sheet).toBeVisible();
    await expect.poll(async () => {
      const [panelBox, stageBox] = await Promise.all([previewPanel.boundingBox(), stage.boundingBox()]);
      return panelBox && stageBox ? Math.abs(panelBox.y + panelBox.height - stageBox.y - stageBox.height) : Infinity;
    }).toBeLessThanOrEqual(2);
    await expect.poll(async () => {
      const [stageBox, sheetBox] = await Promise.all([stage.boundingBox(), sheet.boundingBox()]);
      return Boolean(stageBox && sheetBox && sheetBox.x >= stageBox.x - 1 && sheetBox.y >= stageBox.y - 1
        && sheetBox.x + sheetBox.width <= stageBox.x + stageBox.width + 1
        && sheetBox.y + sheetBox.height <= stageBox.y + stageBox.height + 1);
    }).toBe(true);
    await expect.poll(async () => {
      const [stageBox, sheetBox] = await Promise.all([stage.boundingBox(), sheet.boundingBox()]);
      return Math.max(sheetBox.width / stageBox.width, sheetBox.height / stageBox.height) >= 0.97;
    }).toBe(true);
    await expect.poll(() => page.evaluate(() => [".page-tabs-root", ".page-tab-content", ".paper-stage"].every((selector) => {
      const element = document.querySelector(selector);
      return element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth;
    }))).toBe(true);

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

test("real workflow: show the average OCR text size once above the sheet", async ({ page }) => {
  await openStudio(page);
  const square = await makePng(page, 900, 900);
  await page.getByLabel("Choose images").setInputFiles([
    { name: "average-size-one.png", mimeType: "image/png", buffer: square },
    { name: "average-size-two.png", mimeType: "image/png", buffer: square },
  ]);
  await expect(page.getByRole("button", { name: "Select average-size-one.png" })).toBeVisible();
  await saveOcrRatios(page, { "average-size-one.png": 0.05, "average-size-two.png": 0.1 });
  await page.reload();

  const autoMatch = page.getByRole("checkbox", { name: "Automatically match image text sizes" });
  await expect(autoMatch).toBeChecked();
  const firstSize = page.locator(".image-item-row").filter({ hasText: "average-size-one.png" }).locator(".image-text-size");
  const secondSize = page.locator(".image-item-row").filter({ hasText: "average-size-two.png" }).locator(".image-text-size");
  await expect.poll(async () => Math.abs(await readPrintedTextMm(firstSize) - await readPrintedTextMm(secondSize))).toBeLessThan(0.11);

  await expect(page.locator(".preview-average")).toContainText("Average printed text ≈");
  await expect(page.locator(".preview-average")).toContainText("mm");
  await expect(page.locator(".preview-average")).toHaveCount(1);
  await expect(page.locator(".paper-sheet .sheet-ocr-size")).toHaveCount(0);

  await autoMatch.uncheck();
  await expect.poll(async () => Math.abs(await readPrintedTextMm(firstSize) - await readPrintedTextMm(secondSize))).toBeGreaterThan(0.2);
  await expect.poll(async () => (await readStoredWorkspace(page))?.autoMatchTextSize).toBe(false);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Automatically match image text sizes" })).not.toBeChecked();
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
  await expect.poll(async () => {
    const workspace = await readStoredWorkspace(page);
    const image = workspace?.images.find((candidate) => candidate.name === "paste-ocr.png");
    return image?.ocrScanned === true && Number(image.textHeightRatio) > 0;
  }, { timeout: 120_000 }).toBe(true);

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
  await page.getByLabel("Choose images").setInputFiles([
    { name: "original-size.png", mimeType: "image/png", buffer: image },
    { name: "second-image.png", mimeType: "image/png", buffer: image },
    { name: "third-image.png", mimeType: "image/png", buffer: image },
  ]);

  await page.getByRole("button", { name: "Preview full image original-size.png" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "original-size.png" })).toBeVisible();
  await expect(dialog.locator(".image-preview-count")).toHaveText("1 of 3 images");
  const fullImage = dialog.getByRole("img", { name: "original-size.png" });
  await expect(fullImage).toBeVisible();
  await expect.poll(() => fullImage.evaluate((element) => [element.naturalWidth, element.naturalHeight])).toEqual([640, 480]);

  await dialog.getByRole("button", { name: "Next image" }).click();
  await expect(dialog.getByRole("heading", { name: "second-image.png" })).toBeVisible();
  await expect(dialog.locator(".image-preview-count")).toHaveText("2 of 3 images");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("heading", { name: "third-image.png" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("heading", { name: "original-size.png" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByRole("heading", { name: "third-image.png" })).toBeVisible();
  await dialog.getByRole("button", { name: "Previous image" }).click();
  await expect(dialog.getByRole("heading", { name: "second-image.png" })).toBeVisible();

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
