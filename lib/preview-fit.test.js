import assert from "node:assert/strict";
import test from "node:test";
import { fitPageIntoFrame } from "./preview-fit.js";

test("fits a portrait sheet to the limiting frame height", () => {
  assert.deepEqual(fitPageIntoFrame(600, 900, 1200, 600), { width: 400, height: 600 });
});

test("fits a landscape sheet to the limiting frame width", () => {
  assert.deepEqual(fitPageIntoFrame(900, 600, 600, 1000), { width: 600, height: 400 });
});

test("applies zoom after computing the full-sheet fit size", () => {
  assert.deepEqual(fitPageIntoFrame(600, 900, 1200, 600, 1.5), { width: 600, height: 900 });
});
