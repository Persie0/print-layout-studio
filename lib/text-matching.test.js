import test from "node:test";
import assert from "node:assert/strict";
import { getOcrStatusLabel, getUnscannedImages, getTextMatchScaleFactors, estimatePrintedTextHeightMm, estimateAveragePrintedTextHeightMm, estimateTextHeightRatio } from "./text-matching.js";
import * as textMatching from "./text-matching.js";

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

test("converts a measured printed text height to a matching type size without an 8 point floor", () => {
  assert.ok(Math.abs(textMatching.fontSizePointsForTextHeightMm(2) - 8.0989876265) < 0.001);
  assert.ok(Math.abs(textMatching.fontSizePointsForTextHeightMm(0.5) - 2.0247469066) < 0.001);
  assert.equal(textMatching.fontSizePointsForTextHeightMm(0), null);
});

test("averages detected printed text heights for the current page", () => {
  const images = [
    { id: "small", width: 2000, height: 1000, textHeightRatio: 0.05 },
    { id: "large", width: 2000, height: 1000, textHeightRatio: 0.1 },
    { id: "unscanned", width: 2000, height: 1000 },
  ];
  const placements = [
    { id: "small", type: "image", width: 300, height: 160 },
    { id: "large", type: "image", width: 300, height: 160 },
    { id: "unscanned", type: "image", width: 300, height: 160 },
    { id: "caption", type: "text", width: 200, height: 40 },
  ];

  const sizes = [
    estimatePrintedTextHeightMm(images[0], placements[0], 1),
    estimatePrintedTextHeightMm(images[1], placements[1], 1),
  ];
  const average = estimateAveragePrintedTextHeightMm(images, placements, 1);

  assert.ok(Math.abs(average - (sizes[0] + sizes[1]) / 2) < 0.001);
  assert.equal(estimateAveragePrintedTextHeightMm(images.slice(2), placements.slice(2), 1), null);
});
