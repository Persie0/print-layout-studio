import test from "node:test";
import assert from "node:assert/strict";
import { choosePageLayout } from "./page-orientation.js";

test("chooses the sheet orientation that gives the smallest detected text the greatest height", () => {
  const result = choosePageLayout({
    portraitSize: { width: 100, height: 200 },
    landscapeSize: { width: 200, height: 100 },
    items: [{
      id: "wide-page",
      type: "image",
      width: 1600,
      height: 800,
      scaleFactor: 1,
      textHeightRatio: 0.02,
    }],
  });

  assert.equal(result.orientation, "landscape");
  assert.ok(Math.abs(result.smallestTextHeight - 2) < 0.01);
});

test("maximizes the minimum OCR text height before comparing the other images", () => {
  const result = choosePageLayout({
    portraitSize: { width: 180, height: 240 },
    landscapeSize: { width: 240, height: 180 },
    gap: 4,
    items: [
      { id: "smallest-text", type: "image", width: 1, height: 1, scaleFactor: 1, textHeightRatio: 0.01 },
      { id: "other-text", type: "image", width: 1, height: 1, scaleFactor: 1, textHeightRatio: 0.04 },
    ],
  });

  assert.equal(result.orientation, "portrait");
  assert.ok(result.smallestTextHeight > 1.1 && result.smallestTextHeight < 1.2);
  assert.equal(result.smallestTextHeight, result.textHeights[0]);
  assert.equal(result.textHeights.length, 2);
});

test("preserves image direction while applying OCR size normalization", () => {
  const result = choosePageLayout({
    portraitSize: { width: 100, height: 200 },
    landscapeSize: { width: 200, height: 100 },
    items: [{
      id: "portrait-photo",
      type: "image",
      width: 600,
      height: 1200,
      scaleFactor: 1.5,
      textHeightRatio: 0.04,
    }],
  });
  const placement = result.layout.placements[0];

  assert.equal(result.orientation, "portrait");
  assert.ok(Math.abs(placement.width / placement.height - 0.5) < 0.001);
});

test("fixed text blocks participate in the orientation fit", () => {
  const result = choosePageLayout({
    portraitSize: { width: 100, height: 200 },
    landscapeSize: { width: 200, height: 100 },
    items: [
      { id: "wide-photo", type: "image", width: 3, height: 2 },
      { id: "caption", type: "text", width: 150, height: 30 },
    ],
  });

  assert.equal(result.layout.fits, true);
  assert.equal(result.orientation, "landscape");
  assert.equal(result.layout.placements.length, 2);
});

test("uses portrait as the stable tie-break for equally good layouts", () => {
  const result = choosePageLayout({
    portraitSize: { width: 200, height: 200 },
    landscapeSize: { width: 200, height: 200 },
    items: [{ id: "square", type: "image", width: 1000, height: 1000 }],
  });

  assert.equal(result.orientation, "portrait");
});
