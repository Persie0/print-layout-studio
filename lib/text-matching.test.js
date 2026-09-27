import test from "node:test";
import assert from "node:assert/strict";
import { getOcrStatusLabel, getUnscannedImages, getTextMatchScaleFactors, estimatePrintedTextHeightMm, estimateTextHeightRatio } from "./text-matching.js";

test("estimates text height from valid OCR word boxes", () => {
  const ratio = estimateTextHeightRatio([
    { text: "LABEL", confidence: 92, bbox: { y0: 10, y1: 22 } },
    { text: "small", confidence: 88, bbox: { y0: 30, y1: 40 } },
    { text: "bad", confidence: 10, bbox: { y0: 0, y1: 80 } },
  ], 100);

  assert.ok(Math.abs(ratio - 0.11) < 0.001);
});

test("scales images around a shared median text size and leaves undetected images unchanged", () => {
  const scales = getTextMatchScaleFactors([
    { id: "small-copy", textHeightRatio: 0.05 },
    { id: "large-copy", textHeightRatio: 0.1 },
    { id: "no-copy" },
  ]);

  assert.ok(Math.abs(scales.get("small-copy") - 1.5) < 0.001);
  assert.ok(Math.abs(scales.get("large-copy") - 0.75) < 0.001);
  assert.equal(scales.get("no-copy"), 1);
});

test("keeps OCR outliers from causing extreme photo enlargement", () => {
  const scales = getTextMatchScaleFactors([
    { id: "tiny-text", textHeightRatio: 0.001 },
    { id: "normal-text", textHeightRatio: 0.08 },
    { id: "large-text", textHeightRatio: 0.16 },
  ]);

  assert.equal(scales.get("tiny-text"), 2);
  assert.equal(scales.get("normal-text"), 1);
  assert.equal(scales.get("large-text"), 0.5);
});

test("shows each image OCR status and returns only images that have not been scanned", () => {
  const images = [
    { id: "new" },
    { id: "legacy" },
    { id: "found", ocrScanned: true, textHeightRatio: 0.06 },
    { id: "empty", ocrScanned: true },
  ];

  assert.deepEqual(getUnscannedImages(images).map((image) => image.id), ["new", "legacy"]);
  assert.equal(getOcrStatusLabel(images[0]), "Not scanned");
  assert.equal(getOcrStatusLabel(images[2]), "Text found");
  assert.equal(getOcrStatusLabel(images[3]), "No text found");
});

test("estimates median OCR text height after image scaling and the printed border", () => {
  const image = { width: 2000, height: 1000, ocrScanned: true, textHeightRatio: 0.05 };
  const placement = { width: 300, height: 160 };
  const textHeightMm = estimatePrintedTextHeightMm(image, placement, 1);

  assert.ok(textHeightMm > 2.5 && textHeightMm < 2.6);
});

test("returns no printed text estimate without a saved OCR measurement or placement", () => {
  const placement = { width: 300, height: 160 };
  assert.equal(estimatePrintedTextHeightMm({ width: 2000, height: 1000 }, placement, 1), null);
  assert.equal(estimatePrintedTextHeightMm({ width: 2000, height: 1000, ocrScanned: true }, placement, 1), null);
  assert.equal(estimatePrintedTextHeightMm({ width: 2000, height: 1000, ocrScanned: true, textHeightRatio: 0.05 }, null, 1), null);
});
