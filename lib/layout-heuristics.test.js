import test from "node:test";
import assert from "node:assert/strict";
import { layoutPage } from "./layout.js";

test("tries alternate MaxRects placement heuristics before shrinking every image", () => {
  const result = layoutPage({
    width: 204,
    height: 124,
    items: [
      { id: "wide", type: "image", width: 2258, height: 678, scaleFactor: 1 },
      { id: "mixed-a", type: "image", width: 2049, height: 1192, scaleFactor: 1.15 },
      { id: "mixed-b", type: "image", width: 1977, height: 1089, scaleFactor: 1.15 },
      { id: "mixed-c", type: "image", width: 2002, height: 1508, scaleFactor: 1.15 },
    ],
  });

  assert.equal(result.fits, true);
  assert.ok(result.imageScale > 41.9, `expected scale > 41.9, got ${result.imageScale}`);
});
