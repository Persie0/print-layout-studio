import test from "node:test";
import assert from "node:assert/strict";
import { layoutPage } from "./layout.js";

function hasOverlap(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

test("two square images grow to the largest shared size that fits", () => {
  const result = layoutPage({
    width: 200,
    height: 100,
    gap: 0,
    items: [
      { id: "a", type: "image", width: 1000, height: 1000 },
      { id: "b", type: "image", width: 1000, height: 1000 },
    ],
  });

  assert.equal(result.fits, true);
  assert.ok(Math.abs(result.imageScale - 100) < 0.01);
  assert.equal(result.placements.length, 2);
  assert.equal(hasOverlap(result.placements[0], result.placements[1]), false);
});

test("reserves image border width while maximizing the actual photo area", () => {
  const result = layoutPage({
    width: 100,
    height: 100,
    gap: 0,
    imageBorder: 5,
    items: [{ id: "framed", type: "image", width: 1000, height: 1000 }],
  });

  assert.equal(result.fits, true);
  assert.ok(Math.abs(result.imageScale - 90) < 0.01);
  assert.deepEqual([result.placements[0].x, result.placements[0].y], [0, 0]);
  assert.ok(Math.abs(result.placements[0].width - 100) < 0.01);
  assert.ok(Math.abs(result.placements[0].height - 100) < 0.01);
});

test("uses the configured image gap when choosing the largest common scale", () => {
  const result = layoutPage({
    width: 200,
    height: 100,
    gap: 10,
    items: [
      { id: "left", type: "image", width: 1, height: 1 },
      { id: "right", type: "image", width: 1, height: 1 },
    ],
  });

  assert.equal(result.fits, true);
  assert.ok(Math.abs(result.imageScale - 90) < 0.01);
  assert.equal(result.placements[1].x - (result.placements[0].x + result.placements[0].width), 10);
});

test("packs OCR-matched images using their individual text-size scale factors", () => {
  const result = layoutPage({
    width: 200,
    height: 100,
    gap: 0,
    items: [
      { id: "large-text", type: "image", width: 1, height: 1, scaleFactor: 1 },
      { id: "small-text", type: "image", width: 1, height: 1, scaleFactor: 0.5 },
    ],
  });

  assert.equal(result.fits, true);
  assert.ok(Math.abs(result.imageScale - 100) < 0.01);
  const first = result.placements.find(({ id }) => id === "large-text");
  const second = result.placements.find(({ id }) => id === "small-text");
  assert.ok(Math.abs(first.height - 100) < 0.01);
  assert.ok(Math.abs(second.height - 50) < 0.01);
});

test("preserves each image ratio and keeps placements inside the printable area", () => {
  const result = layoutPage({
    width: 200,
    height: 150,
    gap: 4,
    items: [
      { id: "wide", type: "image", width: 1600, height: 800 },
      { id: "tall", type: "image", width: 600, height: 1200 },
    ],
  });

  assert.equal(result.fits, true);
  for (const placement of result.placements) {
    const source = placement.id === "wide" ? [1600, 800] : [600, 1200];
    assert.ok(Math.abs(placement.width / placement.height - source[0] / source[1]) < 0.001);
    assert.ok(placement.x >= 0 && placement.y >= 0);
    assert.ok(placement.x + placement.width <= 200);
    assert.ok(placement.y + placement.height <= 150);
  }
  assert.equal(hasOverlap(result.placements[0], result.placements[1]), false);
});

test("keeps text blocks whole at their chosen size while scaling images around them", () => {
  const result = layoutPage({
    width: 100,
    height: 100,
    gap: 0,
    items: [
      { id: "photo", type: "image", width: 1, height: 1 },
      { id: "caption", type: "text", width: 60, height: 20 },
    ],
  });

  assert.equal(result.fits, true);
  assert.ok(Math.abs(result.imageScale - 80) < 0.01);
  const text = result.placements.find((item) => item.id === "caption");
  assert.deepEqual([text.width, text.height], [60, 20]);
});

test("reports overflow when a fixed text block is larger than the page", () => {
  const result = layoutPage({
    width: 100,
    height: 100,
    gap: 0,
    items: [{ id: "caption", type: "text", width: 101, height: 20 }],
  });

  assert.equal(result.fits, false);
  assert.deepEqual(result.placements, []);
});
