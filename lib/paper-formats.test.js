import test from "node:test";
import assert from "node:assert/strict";
import { getPageSize, getPrintPageName, isPaperFormat } from "./paper-formats.js";

test("supports common ISO and North American paper formats", () => {
  assert.deepEqual(getPageSize("a3", "portrait"), { width: 841.89, height: 1190.55 });
  assert.deepEqual(getPageSize("a4", "portrait"), { width: 595.28, height: 841.89 });
  assert.deepEqual(getPageSize("a5", "portrait"), { width: 419.53, height: 595.28 });
  assert.deepEqual(getPageSize("letter", "portrait"), { width: 612, height: 792 });
  assert.deepEqual(getPageSize("legal", "portrait"), { width: 612, height: 1008 });
});

test("swaps paper dimensions for landscape and keeps CSS page names valid", () => {
  assert.deepEqual(getPageSize("a4", "landscape"), { width: 841.89, height: 595.28 });
  assert.equal(getPrintPageName("a3"), "A3");
  assert.equal(getPrintPageName("letter"), "letter");
  assert.equal(getPrintPageName("legal"), "legal");
});

test("recognizes only supported paper formats", () => {
  assert.equal(isPaperFormat("a5"), true);
  assert.equal(isPaperFormat("tabloid"), false);
});
